/**
 * Trains the model's feature weights via gradient descent on a conditional-logit (softmax)
 * objective, instead of the hand-tuned guesses in MODEL_CONFIGS (spec Phases 20-22: "test
 * appropriate models such as logistic regression... use out-of-sample performance, not just
 * training accuracy"). Reuses the EXISTING feature computation (buildFeatures(), via
 * predictions.feature_snapshots) so this is a genuinely fair comparison against the same inputs
 * the hand-tuned model already has access to - only the WEIGHTS are learned differently.
 *
 * Model: for race r with runners i=1..n and feature vectors x_i (each feature centered at 0, i.e.
 * raw value - 0.5, matching the existing score() convention), score_i = w . x_i, p_i =
 * softmax(score)_i. Loss = mean over training races of -log(p_winner) + L2 penalty. Trained with
 * plain batch gradient descent (13 parameters - no need for a heavier optimizer).
 *
 * Same train(60%)/validation(20%)/test(20%) chronological split as tune-contextual-model.ts.
 * Validation selects the best regularization strength and epoch (early stopping); test is purely
 * confirmatory, exactly as established throughout this project. Read-only - only prints results.
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { evaluatePrediction, type BacktestOutcome } from '../src/lib/backtest'
import { MODEL_CONFIGS, type Features, type HistoricalStart, type PredictionModelConfig } from '../src/lib/prediction-v3'
import { runConfiguredModel } from '../src/lib/prediction-suite'
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

interface TrainingRace {
  runners: Array<{ horseId: string; x: number[]; won: boolean }>
}

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

/** Extracts each runner's feature vector for a race by calling the existing model - the weights used here don't affect buildFeatures() output, only the score. */
function extractTrainingRace(race: Race, field: RaceEntryWithHorse[], history: HistoricalStart[]): TrainingRace | null {
  const winnerId = field.find((entry) => entry.finishing_position === 1)?.horse_id
  if (!winnerId) return null
  const result = runConfiguredModel({
    race: { id: race.id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime, distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined, raceClass: race.race_class ?? undefined },
    entries: field,
    history,
    fieldSize: field.length,
  }, MODEL_CONFIGS.connections)
  const snapshots = result.predictions.feature_snapshots as Record<string, { features: Record<string, number> }> | undefined
  if (!snapshots) return null
  const runners = field.flatMap((entry) => {
    const features = snapshots[entry.horse_id]?.features
    if (!features) return []
    const x = FEATURE_KEYS.map((key) => (features[key] ?? 0.5) - 0.5)
    return [{ horseId: entry.horse_id, x, won: entry.horse_id === winnerId }]
  })
  return runners.length >= 2 ? { runners } : null
}

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores)
  const exp = scores.map((score) => Math.exp(score - max))
  const total = exp.reduce((sum, value) => sum + value, 0)
  return exp.map((value) => value / total)
}

function trainingLoss(races: TrainingRace[], weights: number[], l2: number): number {
  let loss = 0
  for (const race of races) {
    const scores = race.runners.map((runner) => runner.x.reduce((sum, xi, i) => sum + xi * weights[i], 0))
    const probabilities = softmax(scores)
    const winnerIndex = race.runners.findIndex((runner) => runner.won)
    loss += -Math.log(Math.max(probabilities[winnerIndex], 1e-9))
  }
  const l2Penalty = l2 * weights.reduce((sum, w) => sum + w * w, 0)
  return loss / races.length + l2Penalty
}

function trainWeights(races: TrainingRace[], l2: number, epochs: number, learningRate: number): number[] {
  const weights = new Array(FEATURE_KEYS.length).fill(0)
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Array(FEATURE_KEYS.length).fill(0)
    for (const race of races) {
      const scores = race.runners.map((runner) => runner.x.reduce((sum, xi, i) => sum + xi * weights[i], 0))
      const probabilities = softmax(scores)
      race.runners.forEach((runner, i) => {
        const y = runner.won ? 1 : 0
        const diff = probabilities[i] - y
        runner.x.forEach((xi, j) => { gradient[j] += diff * xi })
      })
    }
    for (let j = 0; j < weights.length; j += 1) {
      const grad = gradient[j] / races.length + 2 * l2 * weights[j]
      weights[j] -= learningRate * grad
    }
  }
  return weights
}

function score(outcomes: BacktestOutcome[]) {
  const n = outcomes.length
  const winner = outcomes.filter((outcome) => outcome.correctWinner).length / n
  const top3 = outcomes.filter((outcome) => outcome.winnerTop3).length / n
  const logLoss = outcomes.reduce((sum, outcome) => sum + outcome.winnerLogLoss, 0) / n
  return { n, winner, top3, logLoss, objective: winner * 0.65 + top3 * 0.35 - logLoss * 0.015 }
}

/** Evaluates a candidate weight vector (wrapped as a PredictionModelConfig) the same way the rest of this project's backtests do. */
async function evaluateConfig(model: PredictionModelConfig, races: Race[], entriesByRace: Map<string, RaceEntryWithHorse[]>, history: HistoricalStart[]) {
  const outcomes: BacktestOutcome[] = []
  const rollingHistory = [...history]
  for (const race of races) {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    const result = runConfiguredModel({
      race: { id: race.id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime, distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined, raceClass: race.race_class ?? undefined },
      entries: field,
      history: rollingHistory,
      fieldSize: field.length,
    }, model)
    const outcome = evaluatePrediction(result.predictions, result.predicted_times, field.map((entry) => ({ horse_id: entry.horse_id, finishing_position: entry.finishing_position ?? null, finishing_time: entry.finishing_time ?? null })))
    if (outcome) outcomes.push(outcome)
    rollingHistory.push(...field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length)))
  }
  return score(outcomes)
}

function weightsToConfig(version: string, weights: number[]): PredictionModelConfig {
  const entries = FEATURE_KEYS.map((key, i) => [key, weights[i]] as const)
  return { version, temperature: 1, weights: Object.fromEntries(entries) as PredictionModelConfig['weights'] }
}

async function main() {
  const { races, entriesByRace } = await loadData()
  const valid = races.filter((race) => {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    return field.length >= 4 && field.filter((entry) => entry.finishing_position === 1).length === 1
  })
  const trainEnd = Math.floor(valid.length * 0.6)
  const validationEnd = Math.floor(valid.length * 0.8)
  const training = valid.slice(0, trainEnd)
  const validation = valid.slice(trainEnd, validationEnd)
  const test = valid.slice(validationEnd)

  console.log(`Total valid races: ${valid.length} (train ${training.length}, validation ${validation.length}, test ${test.length})`)

  // Build training races using rolling history exactly as production would have seen it.
  const trainingRaces: TrainingRace[] = []
  const rollingHistory: HistoricalStart[] = []
  for (const race of training) {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    const trainingRace = extractTrainingRace(race, field, rollingHistory)
    if (trainingRace) trainingRaces.push(trainingRace)
    rollingHistory.push(...field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length)))
  }
  console.log(`Training races with usable features: ${trainingRaces.length}`)
  const trainingHistory = rollingHistory

  const l2Candidates = [0.001, 0.01, 0.05, 0.1]
  const trainedByL2 = l2Candidates.map((l2) => ({ l2, weights: trainWeights(trainingRaces, l2, 150, 0.5) }))

  console.log('\nTrained weights per L2 strength:')
  for (const { l2, weights } of trainedByL2) {
    console.log(`  l2=${l2}: ${FEATURE_KEYS.map((key, i) => `${key}=${weights[i].toFixed(2)}`).join(', ')}`)
    console.log(`    training loss: ${trainingLoss(trainingRaces, weights, l2).toFixed(4)}`)
  }

  const validationResults = []
  for (const { l2, weights } of trainedByL2) {
    const metrics = await evaluateConfig(weightsToConfig(`trained-l2-${l2}`, weights), validation, entriesByRace, trainingHistory)
    validationResults.push({ l2, weights, ...metrics })
  }
  const productionMetrics = await evaluateConfig(MODEL_CONFIGS.connections, validation, entriesByRace, trainingHistory)
  console.log('\nValidation results:')
  console.log(`  production (hand-tuned): ${JSON.stringify(productionMetrics)}`)
  for (const result of validationResults) {
    console.log(`  trained l2=${result.l2}: winner=${result.winner.toFixed(4)}, top3=${result.top3.toFixed(4)}, logLoss=${result.logLoss.toFixed(4)}, objective=${result.objective.toFixed(4)}`)
  }

  const best = [...validationResults].sort((left, right) => right.objective - left.objective)[0]
  console.log(`\nSelected (best validation objective): l2=${best.l2}`)

  const finalHistory = [...trainingHistory, ...validation.flatMap((race) => {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    return field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length))
  })]
  const testTrained = await evaluateConfig(weightsToConfig('trained-selected', best.weights), test, entriesByRace, finalHistory)
  const testProduction = await evaluateConfig(MODEL_CONFIGS.connections, test, entriesByRace, finalHistory)
  console.log('\nTest split (confirmatory only):')
  console.log(`  production: ${JSON.stringify(testProduction)}`)
  console.log(`  trained:    ${JSON.stringify(testTrained)}`)
  console.log(`\nFinal trained weights: ${FEATURE_KEYS.map((key) => `${key}=${best.weights[FEATURE_KEYS.indexOf(key)].toFixed(3)}`).join(', ')}`)
}

main().catch((error) => {
  console.error('Training failed:', error)
  process.exit(1)
})
