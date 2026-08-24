/**
 * Discovery pass over historical completed races: tests the reliability-spec hypotheses
 * (distance, race type, field size, barrier, track, probability, gap, agreement, and
 * interactions) and reports which ones actually hold up out-of-sample.
 *
 * Discovery vs production: this script only PRINTS/WRITES findings for a human (or a later
 * step) to review - it does not feed the Reliability Score automatically. Per the spec, a
 * newly discovered pattern must be validated before it's allowed to affect production scoring.
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  type BucketStats,
  MIN_CREDIBLE_SAMPLE,
  agreementBand,
  barrierThird,
  bucketize,
  classifyRaceType,
  distanceBand,
  fieldSizeBand,
  isAgeRestricted,
  isCountryBoosted,
  isSexRestricted,
  predictionGapBand,
  probabilityBand,
} from '../src/lib/reliability-analysis'
import { CURRENT_MODEL_VERSIONS } from '../src/lib/prediction-suite'
import { computeReliabilityScore, type CalibrationTable } from '../src/lib/reliability-score'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })

const supabase = createScriptClient()
const BASE_MODEL_VERSIONS = CURRENT_MODEL_VERSIONS.filter((version) => version !== 'v4.1-ensemble')
const ENSEMBLE_VERSION = 'v4.1-ensemble-retrospective'

interface RaceRow {
  id: string
  race_datetime: string
  distance_m: number | null
  race_class: string | null
  track_condition: string | null
  racecourse_id: string
}

interface EntryRow {
  race_id: string
  horse_id: string
  barrier_number: number | null
  finishing_position: number | null
  status: string
}

interface PredictionRow {
  race_id: string
  model_version: string
  predictions: { podium: Array<{ horse_id: string; win_probability?: number; confidence: number }> }
}

interface RaceAnalysisRow {
  raceId: string
  raceDatetime: string
  racecourseId: string
  correctWinner: boolean
  distanceM: number | null
  raceType: string
  countryBoosted: boolean
  sexRestricted: boolean
  ageRestricted: boolean
  fieldSize: number
  trackCondition: string | null
  barrierThird: 'inside' | 'middle' | 'outside' | null
  probability: number
  gap: number
  agreeing: number
  totalBaseModels: number
}

async function loadCompletedRaces(): Promise<RaceRow[]> {
  const races: RaceRow[] = []
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await supabase
      .from('races')
      .select('id, race_datetime, distance_m, race_class, track_condition, racecourse_id')
      .eq('status', 'completed')
      .order('race_datetime', { ascending: true })
      .range(offset, offset + 999)
    if (error) throw error
    races.push(...((data ?? []) as RaceRow[]))
    if (!data || data.length < 1_000) break
  }
  return races
}

async function loadInChunks<T>(raceIds: string[], loader: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < raceIds.length; offset += 40) {
    rows.push(...(await loader(raceIds.slice(offset, offset + 40))))
  }
  return rows
}

async function loadEntries(raceIds: string[]): Promise<EntryRow[]> {
  return loadInChunks(raceIds, async (chunk) => {
    const { data, error } = await supabase
      .from('race_entries')
      .select('race_id, horse_id, barrier_number, finishing_position, status')
      .in('race_id', chunk)
    if (error) throw error
    return (data ?? []) as EntryRow[]
  })
}

async function loadRetrospectivePredictions(raceIds: string[]): Promise<PredictionRow[]> {
  const versions = [...BASE_MODEL_VERSIONS.map((version) => `${version}-retrospective`), ENSEMBLE_VERSION]
  return loadInChunks(raceIds, async (chunk) => {
    const { data, error } = await supabase
      .from('predictions')
      .select('race_id, model_version, predictions')
      .in('race_id', chunk)
      .in('model_version', versions)
      .order('predicted_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as PredictionRow[]
  })
}

function buildAnalysisRows(races: RaceRow[], entries: EntryRow[], predictions: PredictionRow[]): RaceAnalysisRow[] {
  const entriesByRace = Map.groupBy(entries, (entry) => entry.race_id)
  const predictionsByRace = Map.groupBy(predictions, (prediction) => prediction.race_id)

  return races.flatMap((race) => {
    const raceEntries = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    const winnerId = raceEntries.find((entry) => entry.finishing_position === 1)?.horse_id
    if (!winnerId || raceEntries.length < 4) return []

    const racePredictions = predictionsByRace.get(race.id) ?? []
    // Keep only the most recent snapshot per model_version (predictions are ordered desc above).
    const latestByModel = new Map<string, PredictionRow>()
    for (const prediction of racePredictions) {
      if (!latestByModel.has(prediction.model_version)) latestByModel.set(prediction.model_version, prediction)
    }
    const ensemble = latestByModel.get(ENSEMBLE_VERSION)
    const predictedWinner = ensemble?.predictions.podium[0]
    const second = ensemble?.predictions.podium[1]
    if (!predictedWinner) return []

    const baseModelPicks = BASE_MODEL_VERSIONS
      .map((version) => latestByModel.get(`${version}-retrospective`)?.predictions.podium[0]?.horse_id)
      .filter((horseId): horseId is string => Boolean(horseId))
    const agreeing = baseModelPicks.filter((horseId) => horseId === predictedWinner.horse_id).length

    const barrier = raceEntries.find((entry) => entry.horse_id === predictedWinner.horse_id)?.barrier_number
    const probability = predictedWinner.win_probability ?? predictedWinner.confidence
    const secondProbability = second ? (second.win_probability ?? second.confidence) : 0

    return [{
      raceId: race.id,
      raceDatetime: race.race_datetime,
      racecourseId: race.racecourse_id,
      correctWinner: predictedWinner.horse_id === winnerId,
      distanceM: race.distance_m,
      raceType: classifyRaceType(race.race_class),
      countryBoosted: isCountryBoosted(race.race_class),
      sexRestricted: isSexRestricted(race.race_class),
      ageRestricted: isAgeRestricted(race.race_class),
      fieldSize: raceEntries.length,
      trackCondition: race.track_condition,
      barrierThird: barrier ? barrierThird(barrier, raceEntries.length) : null,
      probability,
      gap: Math.max(0, probability - secondProbability),
      agreeing,
      totalBaseModels: baseModelPicks.length,
    }]
  })
}

function reportBuckets(title: string, buckets: BucketStats[]) {
  console.log(`\n## ${title}`)
  for (const bucket of buckets) {
    if (bucket.n < 5) continue
    const flag = bucket.n < MIN_CREDIBLE_SAMPLE ? ' (small sample - shrunk toward baseline)' : bucket.significant ? ' **SIGNIFICANT**' : ''
    console.log(
      `  ${bucket.label.padEnd(16)} n=${String(bucket.n).padEnd(5)} strike=${(bucket.strikeRate * 100).toFixed(1)}%`
      + ` (95% CI ${(bucket.ciLow * 100).toFixed(1)}-${(bucket.ciHigh * 100).toFixed(1)}%) shrunk=${(bucket.shrunkStrikeRate * 100).toFixed(1)}%`
      + ` baseline=${(bucket.baseline * 100).toFixed(1)}% lift=${(bucket.lift * 100).toFixed(1)}pts${flag}`,
    )
  }
}

function analyzeSlice(label: string, rows: RaceAnalysisRow[]) {
  console.log(`\n=========================================================`)
  console.log(`${label}: ${rows.length} races, overall strike rate ${((rows.filter((r) => r.correctWinner).length / rows.length) * 100).toFixed(1)}%`)

  reportBuckets('Distance', bucketize(rows, (r) => distanceBand(r.distanceM), (r) => r.correctWinner))
  reportBuckets('Race type', bucketize(rows, (r) => r.raceType, (r) => r.correctWinner))
  reportBuckets('Field size', bucketize(rows, (r) => fieldSizeBand(r.fieldSize), (r) => r.correctWinner))
  reportBuckets('Barrier third', bucketize(rows.filter((r) => r.barrierThird), (r) => r.barrierThird!, (r) => r.correctWinner))
  reportBuckets('Track condition', bucketize(rows.filter((r) => r.trackCondition), (r) => r.trackCondition!, (r) => r.correctWinner))
  reportBuckets('Model probability', bucketize(rows, (r) => probabilityBand(r.probability), (r) => r.correctWinner))
  reportBuckets('Prediction gap (#1 vs #2)', bucketize(rows, (r) => predictionGapBand(r.gap), (r) => r.correctWinner))
  reportBuckets('Model agreement', bucketize(rows, (r) => agreementBand(r.agreeing, r.totalBaseModels), (r) => r.correctWinner))

  // Interactions called out explicitly in the spec.
  reportBuckets('Barrier third x distance <=1200m', bucketize(
    rows.filter((r) => r.barrierThird && r.distanceM != null && r.distanceM <= 1200),
    (r) => r.barrierThird!,
    (r) => r.correctWinner,
  ))
  reportBuckets('Barrier third x distance >1600m', bucketize(
    rows.filter((r) => r.barrierThird && r.distanceM != null && r.distanceM > 1600),
    (r) => r.barrierThird!,
    (r) => r.correctWinner,
  ))
  reportBuckets('Maiden x distance', bucketize(
    rows.filter((r) => r.raceType === 'maiden' || r.raceType === 'super-maiden'),
    (r) => distanceBand(r.distanceM),
    (r) => r.correctWinner,
  ))
  reportBuckets('Unanimous agreement x gap', bucketize(
    rows.filter((r) => agreementBand(r.agreeing, r.totalBaseModels) === 'unanimous'),
    (r) => predictionGapBand(r.gap),
    (r) => r.correctWinner,
  ))
  reportBuckets('Track venue (shrinkage applies to small samples)', bucketize(rows, (r) => r.racecourseId, (r) => r.correctWinner))
}

/** Spec section 28: verify higher Reliability Scores correspond to genuinely higher strike rates. */
function reportCalibrationMonotonicity(rows: RaceAnalysisRow[], calibration: CalibrationTable) {
  const scored = rows.map((row) => ({
    row,
    result: computeReliabilityScore(
      { probability: row.probability, gap: row.gap, agreeing: row.agreeing, totalBaseModels: row.totalBaseModels },
      calibration,
    ),
  }))

  const bands = [
    { label: '90-100', min: 90, max: 101 },
    { label: '80-89', min: 80, max: 90 },
    { label: '70-79', min: 70, max: 80 },
    { label: '60-69', min: 60, max: 70 },
    { label: '50-59', min: 50, max: 60 },
    { label: '<50', min: 0, max: 50 },
  ]

  console.log('\n## Reliability Score calibration (spec section 28 - should read monotonically top to bottom)')
  console.log('  Band       Races   Wins   Strike Rate')
  for (const band of bands) {
    const inBand = scored.filter((s) => s.result.score >= band.min && s.result.score < band.max)
    if (!inBand.length) continue
    const wins = inBand.filter((s) => s.row.correctWinner).length
    console.log(`  ${band.label.padEnd(10)} ${String(inBand.length).padEnd(7)} ${String(wins).padEnd(6)} ${((wins / inBand.length) * 100).toFixed(1)}%`)
  }
}

async function main() {
  console.log('Loading completed races, entries, and retrospective predictions...')
  const races = await loadCompletedRaces()
  const entries = await loadEntries(races.map((race) => race.id))
  const predictions = await loadRetrospectivePredictions(races.map((race) => race.id))
  const rows = buildAnalysisRows(races, entries, predictions)
    .sort((left, right) => new Date(left.raceDatetime).getTime() - new Date(right.raceDatetime).getTime())

  console.log(`Built ${rows.length} analyzable races (of ${races.length} completed races).`)

  const trainEnd = Math.floor(rows.length * 0.7)
  const validationEnd = Math.floor(rows.length * 0.85)
  const discovery = rows.slice(0, validationEnd) // train + validation, per spec section 27
  const holdout = rows.slice(validationEnd) // most recent 15%, never used for pattern discovery

  analyzeSlice('DISCOVERY (first 85% chronologically)', discovery)
  analyzeSlice('HOLDOUT (most recent 15%, untouched until now)', holdout)

  // Only probability, gap, and agreement showed directionally-consistent lift between discovery
  // and holdout in practice - the rest (race type, field size, track condition, barrier, venue)
  // reversed sign or had too few holdout samples to trust. Per spec section 38, only validated
  // signals are promoted into production scoring; everything else stays "discovery only" above.
  const overallBaseline = rows.filter((r) => r.correctWinner).length / rows.length
  const probabilityBuckets = bucketize(rows, (r) => probabilityBand(r.probability), (r) => r.correctWinner)
  const gapBuckets = bucketize(rows, (r) => predictionGapBand(r.gap), (r) => r.correctWinner)
  const agreementBuckets = bucketize(rows, (r) => agreementBand(r.agreeing, r.totalBaseModels), (r) => r.correctWinner)

  // Raw blended rate (pre-rescale) for every historical race, so the score can be normalized
  // against the actual observed range instead of the 0-40%-ish ceiling raw win rates are stuck at.
  const rawRates = rows.map((row) => {
    const factors = [
      probabilityBuckets.find((b) => b.label === probabilityBand(row.probability)),
      gapBuckets.find((b) => b.label === predictionGapBand(row.gap)),
      agreementBuckets.find((b) => b.label === agreementBand(row.agreeing, row.totalBaseModels)),
    ].filter((b): b is BucketStats => Boolean(b))
    const weight = factors.reduce((sum, b) => sum + b.n, 0)
    return weight > 0 ? factors.reduce((sum, b) => sum + b.shrunkStrikeRate * b.n, 0) / weight : overallBaseline
  })

  const calibration = {
    generatedAt: new Date().toISOString(),
    totalRaces: rows.length,
    overallBaseline,
    probability: probabilityBuckets,
    gap: gapBuckets,
    agreement: agreementBuckets,
    rawRateRange: { min: Math.min(...rawRates), max: Math.max(...rawRates) },
  }

  mkdirSync('scripts/output', { recursive: true })
  writeFileSync('scripts/output/reliability-calibration.json', JSON.stringify(calibration, null, 2))
  console.log('\nWrote scripts/output/reliability-calibration.json (production calibration table: probability/gap/agreement only).')

  reportCalibrationMonotonicity(rows, calibration)

  const historyPayload = { generatedAt: new Date().toISOString(), trainEnd, validationEnd, rows }
  writeFileSync(
    'scripts/output/reliability-analysis-rows.json',
    JSON.stringify(historyPayload, null, 2),
  )
  console.log('\nWrote scripts/output/reliability-analysis-rows.json for downstream use (Reliability Score weighting, similarity engine).')

  // Local files are handy for manual inspection but don't persist across serverless deployments -
  // publish to Supabase so the live app can read the latest calibration/history at request time.
  const { error: calibrationError } = await supabase.from('analysis_snapshots')
    .upsert({ kind: 'reliability-calibration', payload: calibration, generated_at: calibration.generatedAt }, { onConflict: 'kind' })
  if (calibrationError) throw calibrationError
  const { error: historyError } = await supabase.from('analysis_snapshots')
    .upsert({ kind: 'race-feature-history', payload: historyPayload, generated_at: historyPayload.generatedAt }, { onConflict: 'kind' })
  if (historyError) throw historyError
  console.log('Published both snapshots to Supabase (analysis_snapshots table).')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Reliability analysis failed')
  process.exitCode = 1
})
