/**
 * Separate PLACE model experiment (reliability spec section 9: "Do not derive place probability
 * directly from win confidence. Create dedicated modelling targets."). The current production
 * pipeline (prediction-v3.ts's placeProbabilities()) derives every horse's top3_probability
 * SOLELY via Harville's (1973) formula applied to the WIN model's own probabilities - there is no
 * independently-trained place target anywhere in the internal Racing.com horse pipeline (verified
 * via audit; PuntersEdge/paper-betting side has the same limitation, see harville.ts).
 *
 * This script trains a genuinely independent PLACE classifier: target = "finished within the
 * field's actual TAB-payable places" (src/lib/betting/place-rules.ts's paidPlacesCount - NOT a
 * fixed top-3 assumption), using the SAME 13 features as the win model (fair comparison, only the
 * target + weights differ) via simple per-runner logistic regression (spec section 14: "simple
 * models first"), trained with plain batch gradient descent - consistent with
 * train-logit-weights.ts's existing approach for the WIN model.
 *
 * Compares the trained place model against the current production Harville-derived place
 * probability out-of-sample (chronological 60/20/20 split, test set purely confirmatory). Per
 * spec section 56 ("do not blindly rewrite the production model"), this is read-only research -
 * it only prints a report; promoting a genuinely better place model into production is a
 * separate, deliberate follow-up decision.
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { MODEL_CONFIGS, type Features, type HistoricalStart } from '../src/lib/prediction-v3'
import { runConfiguredModel, runEnsemble, PRODUCTION_ENSEMBLE_CONFIGS } from '../src/lib/prediction-suite'
import { paidPlacesCount } from '../src/lib/betting/place-rules'
import { parseStandardTimeDifference } from '../src/lib/sectional-speed'
import type { RaceEntryWithHorse } from '../src/lib/types'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })

const FEATURE_KEYS = [
  'recentForm', 'contextualForm', 'distanceSuitability', 'conditionSuitability', 'courseSuitability',
  'classMovement', 'speedRating', 'jockeyForm', 'trainerForm', 'partnershipForm',
  'barrierSuitability', 'weightSuitability', 'fitness',
] as const satisfies ReadonlyArray<keyof Omit<Features, 'historyStarts'>>

interface Race {
  id: string
  race_datetime: string
  distance_m: number | null
  track_condition: string | null
  race_class: string | null
  racecourse_id: string
}

interface RunnerSample { x: number[]; placed: boolean; harvilleProbability: number }
interface TrainingRace { runners: RunnerSample[] }

const supabase = createScriptClient()

async function loadData() {
  const races: Race[] = []
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await supabase.from('races')
      .select('id,race_datetime,distance_m,track_condition,race_class,racecourse_id')
      .eq('status', 'completed').order('race_datetime').range(offset, offset + 999)
    if (error) throw error
    races.push(...((data ?? []) as Race[]))
    if (!data || data.length < 1_000) break
  }
  const entries: (RaceEntryWithHorse & { speed_ratings: { standard_time_difference?: string | null } | null })[] = []
  for (let offset = 0; offset < races.length; offset += 40) {
    const { data, error } = await supabase.from('race_entries').select('*,horses(*)')
      .in('race_id', races.slice(offset, offset + 40).map((race) => race.id))
    if (error) throw error
    entries.push(...((data ?? []) as typeof entries))
  }
  return { races, entriesByRace: Map.groupBy(entries, (entry) => entry.race_id) }
}

function start(entry: RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race: Race, fieldSize: number): HistoricalStart {
  return {
    raceId: race.id, horseId: entry.horse_id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime,
    distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined,
    raceClass: race.race_class ?? undefined, finishingPosition: entry.finishing_position, fieldSize,
    finishingTime: entry.finishing_time, margin: entry.margin, barrier: entry.barrier_number,
    weight: entry.weight_carried, jockey: entry.jockey, trainer: entry.trainer,
    standardTimeDifference: parseStandardTimeDifference(entry.speed_ratings?.standard_time_difference) ?? undefined,
  }
}

/** Extracts per-runner feature vectors + "placed" label + the current production Harville-derived place probability, all using only data available at race time. */
function extractPlaceRace(race: Race, field: RaceEntryWithHorse[], history: HistoricalStart[]): TrainingRace | null {
  const paidPlaces = paidPlacesCount('horse', field.length)
  const raceContext = { id: race.id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime, distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined, raceClass: race.race_class ?? undefined }

  const featureResult = runConfiguredModel({ race: raceContext, entries: field, history, fieldSize: field.length }, MODEL_CONFIGS.connections)
  const snapshots = featureResult.predictions.feature_snapshots as Record<string, { features: Record<string, number> }> | undefined
  if (!snapshots) return null

  const ensembleResult = runEnsemble({ race: raceContext, entries: field, history, fieldSize: field.length }, PRODUCTION_ENSEMBLE_CONFIGS)
  const harvilleByHorse = new Map(ensembleResult.predictions.all_horses.map((horse) => [horse.horse_id, horse.top3_probability ?? 0]))

  const runners = field.flatMap((entry) => {
    const features = snapshots[entry.horse_id]?.features
    if (!features || entry.finishing_position == null) return []
    const x = FEATURE_KEYS.map((key) => (features[key] ?? 0.5) - 0.5)
    return [{
      x,
      placed: entry.finishing_position <= paidPlaces,
      harvilleProbability: harvilleByHorse.get(entry.horse_id) ?? 0,
    }]
  })
  return runners.length >= 2 ? { runners } : null
}

function sigmoid(z: number) { return 1 / (1 + Math.exp(-z)) }

function trainWeights(races: TrainingRace[], l2: number, epochs: number, learningRate: number): number[] {
  const weights = new Array(FEATURE_KEYS.length).fill(0)
  const runners = races.flatMap((race) => race.runners)
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Array(FEATURE_KEYS.length).fill(0)
    for (const runner of runners) {
      const z = runner.x.reduce((sum, xi, i) => sum + xi * weights[i], 0)
      const p = sigmoid(z)
      const diff = p - (runner.placed ? 1 : 0)
      runner.x.forEach((xi, j) => { gradient[j] += diff * xi })
    }
    for (let j = 0; j < weights.length; j += 1) {
      const grad = gradient[j] / runners.length + 2 * l2 * weights[j]
      weights[j] -= learningRate * grad
    }
  }
  return weights
}

function evaluate(races: TrainingRace[], weights: number[] | null) {
  const runners = races.flatMap((race) => race.runners)
  let brierTrained = 0
  let logLossTrained = 0
  let brierHarville = 0
  let logLossHarville = 0
  for (const runner of runners) {
    const outcome = runner.placed ? 1 : 0
    const pTrained = weights ? sigmoid(runner.x.reduce((sum, xi, i) => sum + xi * weights[i], 0)) : 0.5
    brierTrained += (pTrained - outcome) ** 2
    logLossTrained += outcome ? -Math.log(Math.max(pTrained, 1e-9)) : -Math.log(Math.max(1 - pTrained, 1e-9))
    const pHarville = Math.min(1 - 1e-9, Math.max(1e-9, runner.harvilleProbability))
    brierHarville += (pHarville - outcome) ** 2
    logLossHarville += outcome ? -Math.log(pHarville) : -Math.log(1 - pHarville)
  }
  const n = runners.length || 1
  return {
    n: runners.length,
    trained: { brier: brierTrained / n, logLoss: logLossTrained / n },
    harville: { brier: brierHarville / n, logLoss: logLossHarville / n },
  }
}

function weightsLabel(weights: number[]) {
  return FEATURE_KEYS.map((key, i) => `${key}=${weights[i].toFixed(3)}`).join(', ')
}

async function main() {
  const { races, entriesByRace } = await loadData()
  const valid = races
    .filter((race) => (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched').length >= 4)
    .sort((left, right) => left.race_datetime.localeCompare(right.race_datetime))

  const trainEnd = Math.floor(valid.length * 0.6)
  const validationEnd = Math.floor(valid.length * 0.8)
  const trainRaces = valid.slice(0, trainEnd)
  const validationRaces = valid.slice(trainEnd, validationEnd)
  const testRaces = valid.slice(validationEnd)
  console.log(`Total valid races: ${valid.length} (train ${trainRaces.length}, validation ${validationRaces.length}, test ${testRaces.length})`)

  function buildRaces(slice: Race[], startingHistory: HistoricalStart[]) {
    const built: TrainingRace[] = []
    const rollingHistory = [...startingHistory]
    for (const race of slice) {
      const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
      const placeRace = extractPlaceRace(race, field, rollingHistory)
      if (placeRace) built.push(placeRace)
      rollingHistory.push(...field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length)))
    }
    return { built, historyAfter: rollingHistory }
  }

  const { built: trainingData, historyAfter: historyAfterTrain } = buildRaces(trainRaces, [])
  console.log(`Training races with usable place features: ${trainingData.length} (${trainingData.reduce((sum, r) => sum + r.runners.length, 0)} runner-rows)`)

  const l2Candidates = [0.001, 0.01, 0.05, 0.1]
  const trainedByL2 = l2Candidates.map((l2) => ({ l2, weights: trainWeights(trainingData, l2, 150, 0.5) }))

  const { built: validationData, historyAfter: historyAfterValidation } = buildRaces(validationRaces, historyAfterTrain)
  console.log('\nValidation results (selecting by lowest place logLoss):')
  const validationResults = trainedByL2.map(({ l2, weights }) => ({ l2, weights, ...evaluate(validationData, weights) }))
  for (const result of validationResults) {
    console.log(`  l2=${result.l2}: trained logLoss=${result.trained.logLoss.toFixed(4)} brier=${result.trained.brier.toFixed(4)}` +
      `  |  harville (same set) logLoss=${result.harville.logLoss.toFixed(4)} brier=${result.harville.brier.toFixed(4)}  (n=${result.n})`)
  }
  const best = [...validationResults].sort((left, right) => left.trained.logLoss - right.trained.logLoss)[0]
  console.log(`\nSelected: l2=${best.l2}`)
  console.log(`  Weights: ${weightsLabel(best.weights)}`)

  const { built: testData } = buildRaces(testRaces, historyAfterValidation)
  const testResult = evaluate(testData, best.weights)
  console.log(`\nTest split (confirmatory only, n=${testResult.n} runner-rows across ${testData.length} races):`)
  console.log(`  Trained place-logistic:      brier=${testResult.trained.brier.toFixed(4)}  logLoss=${testResult.trained.logLoss.toFixed(4)}`)
  console.log(`  Harville (production today): brier=${testResult.harville.brier.toFixed(4)}  logLoss=${testResult.harville.logLoss.toFixed(4)}`)

  const trainedWins = testResult.trained.logLoss < testResult.harville.logLoss && testResult.trained.brier < testResult.harville.brier
  console.log(`\nVerdict: ${trainedWins ? 'Trained place model beats Harville-derived place probability out-of-sample on BOTH metrics.' : 'Trained place model does NOT clearly beat the current Harville-derived place probability out-of-sample.'}`)
  console.log('Per spec section 56, this is a research finding only - promoting a new place model into production is a separate, deliberate decision, not automatic.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Place model training failed')
  process.exitCode = 1
})
