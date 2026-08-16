import 'dotenv/config'
import { config } from 'dotenv'
import { evaluatePrediction, type BacktestOutcome } from '../src/lib/backtest'
import {
  MODEL_CONFIGS,
  type Features,
  type HistoricalStart,
  type PredictionModelConfig,
} from '../src/lib/prediction-v3'
import { runConfiguredModel } from '../src/lib/prediction-suite'
import type { RaceEntryWithHorse } from '../src/lib/types'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })

interface Race {
  id: string
  race_datetime: string
  distance_m: number | null
  track_condition: string | null
  race_class: string | null
  racecourse_id: string
}

interface Outcome extends BacktestOutcome {
  confidence: number
}

type WeightKey = keyof Omit<Features, 'historyStarts'>

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
  const entries: RaceEntryWithHorse[] = []
  for (let offset = 0; offset < races.length; offset += 40) {
    const { data, error } = await supabase.from('race_entries').select('*,horses(*)')
      .in('race_id', races.slice(offset, offset + 40).map((race) => race.id))
    if (error) throw error
    entries.push(...((data ?? []) as RaceEntryWithHorse[]))
  }
  return { races, entriesByRace: Map.groupBy(entries, (entry) => entry.race_id) }
}

function start(entry: RaceEntryWithHorse, race: Race, fieldSize: number): HistoricalStart {
  return {
    raceId: race.id, horseId: entry.horse_id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime,
    distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined,
    raceClass: race.race_class ?? undefined, finishingPosition: entry.finishing_position, fieldSize,
    finishingTime: entry.finishing_time, margin: entry.margin, barrier: entry.barrier_number,
    weight: entry.weight_carried, jockey: entry.jockey, trainer: entry.trainer,
  }
}

function score(outcomes: Outcome[]) {
  const n = outcomes.length
  const winner = outcomes.filter((outcome) => outcome.correctWinner).length / n
  const top3 = outcomes.filter((outcome) => outcome.winnerTop3).length / n
  const logLoss = outcomes.reduce((sum, outcome) => sum + outcome.winnerLogLoss, 0) / n
  return { winner, top3, logLoss, objective: winner * 0.65 + top3 * 0.35 - logLoss * 0.015 }
}

function candidate(version: string, changes: Partial<Record<WeightKey, number>>, temperature = MODEL_CONFIGS.connections.temperature): PredictionModelConfig {
  return { version, temperature, weights: { ...MODEL_CONFIGS.connections.weights, ...changes } }
}

async function evaluate(config: PredictionModelConfig, races: Race[], entriesByRace: Map<string, RaceEntryWithHorse[]>, history: HistoricalStart[]) {
  const outcomes: Outcome[] = []
  const rollingHistory = [...history]
  for (const race of races) {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    const result = runConfiguredModel({
      race: { id: race.id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime, distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined, raceClass: race.race_class ?? undefined },
      entries: field,
      history: rollingHistory,
      fieldSize: field.length,
    }, config)
    const outcome = evaluatePrediction(result.predictions, result.predicted_times, field.map((entry) => ({ horse_id: entry.horse_id, finishing_position: entry.finishing_position ?? null, finishing_time: entry.finishing_time ?? null })))
    if (outcome) outcomes.push({ ...outcome, confidence: result.confidence_scores.winner })
    rollingHistory.push(...field.map((entry) => start(entry, race, field.length)))
  }
  return { outcomes, metrics: score(outcomes) }
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
  const trainingHistory = training.flatMap((race) => {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    return field.map((entry) => start(entry, race, field.length))
  })
  const candidates = [
    MODEL_CONFIGS.connections,
    candidate('tune-form-up', { recentForm: 2.8, contextualForm: 3.8 }),
    candidate('tune-form-down', { recentForm: 1.7, contextualForm: 2.6 }),
    candidate('tune-connections-up', { jockeyForm: 1.9, trainerForm: 2.1, partnershipForm: 2 }),
    candidate('tune-connections-down', { jockeyForm: 1.1, trainerForm: 1.3, partnershipForm: 1.1 }),
    candidate('tune-weight-up', { weightSuitability: 1.5 }),
    candidate('tune-weight-down', { weightSuitability: 0.5 }),
    candidate('tune-context-course', { distanceSuitability: 1.2, conditionSuitability: 1, courseSuitability: 0.8 }),
    candidate('tune-class-fitness', { classMovement: 1, fitness: 0.8 }),
    candidate('tune-hot', {}, 1.8),
    candidate('tune-cool', {}, 2.7),
  ]
  const validationResults = []
  for (const model of candidates) {
    const result = await evaluate(model, validation, entriesByRace, trainingHistory)
    validationResults.push({ config: model, ...result.metrics })
  }
  validationResults.sort((left, right) => right.objective - left.objective)
  const selected = validationResults[0].config
  const finalHistory = [...trainingHistory, ...validation.flatMap((race) => {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    return field.map((entry) => start(entry, race, field.length))
  })]
  const testResults = []
  for (const model of candidates) {
    const result = await evaluate(model, test, entriesByRace, finalHistory)
    testResults.push({ model: model.version, ...result.metrics })
  }
  testResults.sort((left, right) => right.objective - left.objective)
  console.log(JSON.stringify({ total: valid.length, training: training.length, validation: validation.length, test: test.length, validationResults: validationResults.map(({ config: model, ...metrics }) => ({ model: model.version, temperature: model.temperature, ...metrics })), selected, testResults }, null, 2))
}

main().catch((error: unknown) => {
  console.error('Tuning failed', error)
  process.exitCode = 1
})
