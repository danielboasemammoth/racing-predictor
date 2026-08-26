/**
 * Walk-forward k-fold validation (spec Phase 28) of the trained-weight idea from
 * train-logit-weights.ts: does it consistently beat the hand-tuned production model across
 * SEVERAL rolling train/test splits, or was the earlier single-split validation win a fluke? L2
 * is fixed at 0.05 (the winner from the earlier single-split run) rather than re-searched per
 * fold, so this fold sweep can't overfit its own hyperparameter choice. Each fold trains on all
 * races before a cut point and tests on the next chronological chunk (expanding window, exactly
 * the "train Jan-Jun, test Jul; train Jan-Jul, test Aug" pattern the spec describes). Read-only.
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

const L2 = 0.05
const FOLDS = 5

interface Race {
  id: string
  race_datetime: string
  distance_m: number | null
  track_condition: string | null
  race_class: string | null
  racecourse_id: string
}

interface TrainingRace {
  runners: Array<{ x: number[]; won: boolean }>
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
    return [{ x, won: entry.horse_id === winnerId }]
  })
  return runners.length >= 2 ? { runners } : null
}

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores)
  const exp = scores.map((score) => Math.exp(score - max))
  const total = exp.reduce((sum, value) => sum + value, 0)
  return exp.map((value) => value / total)
}

function trainWeights(races: TrainingRace[], l2: number, epochs: number, learningRate: number): number[] {
  const weights = new Array(FEATURE_KEYS.length).fill(0)
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Array(FEATURE_KEYS.length).fill(0)
    for (const race of races) {
      const scores = race.runners.map((runner) => runner.x.reduce((sum, xi, i) => sum + xi * weights[i], 0))
      const probabilities = softmax(scores)
      race.runners.forEach((runner, i) => {
        const diff = probabilities[i] - (runner.won ? 1 : 0)
        runner.x.forEach((xi, j) => { gradient[j] += diff * xi })
      })
    }
    for (let j = 0; j < weights.length; j += 1) {
      weights[j] -= learningRate * (gradient[j] / races.length + 2 * l2 * weights[j])
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

function weightsToConfig(weights: number[]): PredictionModelConfig {
  const entries = FEATURE_KEYS.map((key, i) => [key, weights[i]] as const)
  return { version: 'trained', temperature: 1, weights: Object.fromEntries(entries) as PredictionModelConfig['weights'] }
}

async function main() {
  const { races, entriesByRace } = await loadData()
  const valid = races.filter((race) => {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    return field.length >= 4 && field.filter((entry) => entry.finishing_position === 1).length === 1
  })
  console.log(`Total valid races: ${valid.length}, running ${FOLDS} expanding-window folds (fixed l2=${L2})`)

  const chunkSize = Math.floor(valid.length / (FOLDS + 1))
  const results: Array<{ fold: number; trainSize: number; testSize: number; production: ReturnType<typeof score>; trained: ReturnType<typeof score> }> = []

  for (let fold = 1; fold <= FOLDS; fold += 1) {
    const trainEnd = chunkSize * fold
    const testEnd = Math.min(chunkSize * (fold + 1), valid.length)
    const trainRaces = valid.slice(0, trainEnd)
    const testRaces = valid.slice(trainEnd, testEnd)
    if (!testRaces.length) break

    const trainingRaces: TrainingRace[] = []
    const rollingHistory: HistoricalStart[] = []
    for (const race of trainRaces) {
      const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
      const trainingRace = extractTrainingRace(race, field, rollingHistory)
      if (trainingRace) trainingRaces.push(trainingRace)
      rollingHistory.push(...field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length)))
    }

    const weights = trainWeights(trainingRaces, L2, 150, 0.5)
    const production = await evaluateConfig(MODEL_CONFIGS.connections, testRaces, entriesByRace, rollingHistory)
    const trained = await evaluateConfig(weightsToConfig(weights), testRaces, entriesByRace, rollingHistory)

    results.push({ fold, trainSize: trainingRaces.length, testSize: testRaces.length, production, trained })
    console.log(`Fold ${fold}: train=${trainingRaces.length}, test=${testRaces.length}`)
    console.log(`  production: objective=${production.objective.toFixed(4)}, winner=${production.winner.toFixed(4)}, logLoss=${production.logLoss.toFixed(4)}`)
    console.log(`  trained:    objective=${trained.objective.toFixed(4)}, winner=${trained.winner.toFixed(4)}, logLoss=${trained.logLoss.toFixed(4)}`)
    console.log(`  winner: ${trained.objective > production.objective ? 'TRAINED' : 'production'}`)
  }

  const trainedWins = results.filter((r) => r.trained.objective > r.production.objective).length
  const avgProduction = results.reduce((sum, r) => sum + r.production.objective, 0) / results.length
  const avgTrained = results.reduce((sum, r) => sum + r.trained.objective, 0) / results.length

  console.log(`\n=== Summary across ${results.length} folds ===`)
  console.log(`Trained beat production in ${trainedWins}/${results.length} folds`)
  console.log(`Average objective - production: ${avgProduction.toFixed(4)}, trained: ${avgTrained.toFixed(4)}`)
}

main().catch((error) => {
  console.error('K-fold validation failed:', error)
  process.exit(1)
})
