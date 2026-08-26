/**
 * Weight-tuning experiment specifically for the (newly benchmarked) speedRating feature: is
 * there a nonzero weight that beats the current production weight (0, i.e. disabled) on a
 * proper chronological train/validation/test split? Modeled on tune-contextual-model.ts's
 * methodology. Read-only - only prints results; production weights are updated by hand afterward
 * if a candidate demonstrably wins on the held-out test split.
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { evaluatePrediction, type BacktestOutcome } from '../src/lib/backtest'
import {
  MODEL_CONFIGS,
  type HistoricalStart,
  type PredictionModelConfig,
} from '../src/lib/prediction-v3'
import { runConfiguredModel } from '../src/lib/prediction-suite'
import { parseStandardTimeDifference } from '../src/lib/sectional-speed'
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

function score(outcomes: Outcome[]) {
  const n = outcomes.length
  const winner = outcomes.filter((outcome) => outcome.correctWinner).length / n
  const top3 = outcomes.filter((outcome) => outcome.winnerTop3).length / n
  const brier = outcomes.reduce((sum, outcome) => sum + outcome.winnerBrierScore, 0) / n
  const logLoss = outcomes.reduce((sum, outcome) => sum + outcome.winnerLogLoss, 0) / n
  return { n, winner, top3, brier, logLoss, objective: winner * 0.65 + top3 * 0.35 - logLoss * 0.015 }
}

function candidate(version: string, speedRating: number): PredictionModelConfig {
  return { version, temperature: MODEL_CONFIGS.connections.temperature, weights: { ...MODEL_CONFIGS.connections.weights, speedRating } }
}

async function evaluate(model: PredictionModelConfig, races: Race[], entriesByRace: Map<string, RaceEntryWithHorse[]>, history: HistoricalStart[]) {
  const outcomes: Outcome[] = []
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
    if (outcome) outcomes.push({ ...outcome, confidence: result.confidence_scores.winner })
    rollingHistory.push(...field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length)))
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
    return field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length))
  })

  const candidates = [
    candidate('speed-0.0 (current production)', 0),
    candidate('speed-0.5', 0.5),
    candidate('speed-1.0', 1.0),
    candidate('speed-1.5', 1.5),
    candidate('speed-2.0', 2.0),
    candidate('speed-3.0', 3.0),
  ]

  const validationResults: Array<{ model: string } & ReturnType<typeof score>> = []
  for (const model of candidates) {
    const result = await evaluate(model, validation, entriesByRace, trainingHistory)
    validationResults.push({ model: model.version, ...result.metrics })
  }
  validationResults.sort((left, right) => right.objective - left.objective)
  const selected = candidates.find((model) => model.version === validationResults[0].model)!

  const finalHistory = [...trainingHistory, ...validation.flatMap((race) => {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    return field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length))
  })]
  const testResults: Array<{ model: string } & ReturnType<typeof score>> = []
  for (const model of candidates) {
    const result = await evaluate(model, test, entriesByRace, finalHistory)
    testResults.push({ model: model.version, ...result.metrics })
  }
  testResults.sort((left, right) => right.objective - left.objective)

  console.log(JSON.stringify({
    total: valid.length, training: training.length, validation: validation.length, test: test.length,
    validationResults, selected: selected.version, testResults,
  }, null, 2))
}

main().catch((error) => {
  console.error('Tuning failed:', error)
  process.exit(1)
})
