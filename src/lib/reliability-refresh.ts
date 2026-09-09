import type { SupabaseClient } from '@supabase/supabase-js'
import {
  agreementBand,
  barrierThird,
  bucketize,
  classifyRaceType,
  isAgeRestricted,
  isCountryBoosted,
  isSexRestricted,
  predictionGapBand,
  probabilityBand,
} from '@/lib/reliability-analysis'
import { CURRENT_MODEL_VERSIONS, PRODUCTION_MODEL_VERSION } from '@/lib/prediction-suite'
import { computeComparableCohort } from '@/lib/reliability-score'

// v4.1-ensemble (the pure fundamentals ensemble, no longer Champion) is excluded from "base
// model" agreement counting alongside PRODUCTION_MODEL_VERSION itself - both are derived/blended
// outputs, not independent fundamentals variants.
export const BASE_MODEL_VERSIONS = CURRENT_MODEL_VERSIONS.filter((version) => version !== 'v4.1-ensemble' && version !== PRODUCTION_MODEL_VERSION)
export const ENSEMBLE_VERSION = `${PRODUCTION_MODEL_VERSION}-retrospective`

export interface RaceRow {
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
  sectional_times: { odds?: Array<{ win?: number | string | null }> } | null
}

interface PredictionRow {
  race_id: string
  model_version: string
  predictions: { podium: Array<{ horse_id: string; win_probability?: number; confidence: number }> }
}

export interface RaceAnalysisRow {
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
  /** Best recorded win price from Racing.com's own feed - NOT a confirmed TAB/Betfair price. */
  bestRecordedOdds: number | null
}

export async function loadCompletedRaces(supabase: SupabaseClient): Promise<RaceRow[]> {
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

export async function loadEntries(supabase: SupabaseClient, raceIds: string[]): Promise<EntryRow[]> {
  return loadInChunks(raceIds, async (chunk) => {
    const { data, error } = await supabase
      .from('race_entries')
      .select('race_id, horse_id, barrier_number, finishing_position, status, sectional_times')
      .in('race_id', chunk)
    if (error) throw error
    return (data ?? []) as EntryRow[]
  })
}

export async function loadRetrospectivePredictions(supabase: SupabaseClient, raceIds: string[]): Promise<PredictionRow[]> {
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

export function buildAnalysisRows(races: RaceRow[], entries: EntryRow[], predictions: PredictionRow[]): RaceAnalysisRow[] {
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

    const winnerEntry = raceEntries.find((entry) => entry.horse_id === predictedWinner.horse_id)
    const recordedPrices = (winnerEntry?.sectional_times?.odds ?? [])
      .map((quote) => Number(quote.win))
      .filter((price) => Number.isFinite(price) && price > 0)
    const bestRecordedOdds = recordedPrices.length ? Math.max(...recordedPrices) : null

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
      bestRecordedOdds,
    }]
  })
}

export interface CalibrationPublishResult {
  rows: RaceAnalysisRow[]
  trainEnd: number
  validationEnd: number
  calibration: {
    generatedAt: string
    totalRaces: number
    overallBaseline: number
    probability: ReturnType<typeof bucketize>
    gap: ReturnType<typeof bucketize>
    agreement: ReturnType<typeof bucketize>
    rawRateRange: { min: number; max: number }
  }
  historyPayload: { generatedAt: string; trainEnd: number; validationEnd: number; rows: RaceAnalysisRow[] }
}

/**
 * Loads every completed race + its retrospective predictions, builds the Reliability Score's
 * comparable-cohort history, and publishes both the calibration table and the raw history rows to
 * Supabase (analysis_snapshots) - the exact same computation `scripts/reliability-analysis.ts`
 * already did, extracted so it can ALSO run as a scheduled admin action
 * (`/api/admin/reliability-refresh`) instead of only ever being a manually-run script. This is
 * what keeps the Reliability Score / Segment Explorer / similar-races data current as the
 * historical dataset keeps growing - without this being re-run periodically, all of that stays
 * frozen at whatever it looked like the last time someone manually ran the script.
 */
export async function refreshReliabilityCalibration(supabase: SupabaseClient): Promise<CalibrationPublishResult> {
  const races = await loadCompletedRaces(supabase)
  const entries = await loadEntries(supabase, races.map((race) => race.id))
  const predictions = await loadRetrospectivePredictions(supabase, races.map((race) => race.id))
  const rows = buildAnalysisRows(races, entries, predictions)
    .sort((left, right) => new Date(left.raceDatetime).getTime() - new Date(right.raceDatetime).getTime())

  const trainEnd = Math.floor(rows.length * 0.7)
  const validationEnd = Math.floor(rows.length * 0.85)

  const overallBaseline = rows.length ? rows.filter((r) => r.correctWinner).length / rows.length : 0
  const probabilityBuckets = bucketize(rows, (r) => probabilityBand(r.probability), (r) => r.correctWinner)
  const gapBuckets = bucketize(rows, (r) => predictionGapBand(r.gap), (r) => r.correctWinner)
  const agreementBuckets = bucketize(rows, (r) => agreementBand(r.agreeing, r.totalBaseModels), (r) => r.correctWinner)

  // Raw comparable-cohort rate (pre-rescale) for every historical race, using the SAME single
  // joint-cohort tiered lookup the live score uses (computeComparableCohort) - never the old
  // "sum three overlapping buckets" blend, which double/triple-counted the same races.
  const rawRates = rows.map((row) =>
    computeComparableCohort(
      { probability: row.probability, gap: row.gap, agreeing: row.agreeing, totalBaseModels: row.totalBaseModels },
      rows,
    ).shrunkStrikeRate,
  )

  const generatedAt = new Date().toISOString()
  const calibration = {
    generatedAt,
    totalRaces: rows.length,
    overallBaseline,
    probability: probabilityBuckets,
    gap: gapBuckets,
    agreement: agreementBuckets,
    rawRateRange: rows.length
      ? { min: Math.min(...rawRates), max: Math.max(...rawRates) }
      : { min: 0, max: 1 },
  }
  const historyPayload = { generatedAt, trainEnd, validationEnd, rows }

  const { error: calibrationError } = await supabase.from('analysis_snapshots')
    .upsert({ kind: 'reliability-calibration', payload: calibration, generated_at: generatedAt }, { onConflict: 'kind' })
  if (calibrationError) throw calibrationError
  const { error: historyError } = await supabase.from('analysis_snapshots')
    .upsert({ kind: 'race-feature-history', payload: historyPayload, generated_at: generatedAt }, { onConflict: 'kind' })
  if (historyError) throw historyError

  return { rows, trainEnd, validationEnd, calibration, historyPayload }
}
