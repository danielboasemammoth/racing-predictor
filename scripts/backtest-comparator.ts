import 'dotenv/config'
import { config } from 'dotenv'
import { evaluatePrediction, type BacktestOutcome } from '../src/lib/backtest'
import { MODEL_CONFIGS, type HistoricalStart, type PredictionModelConfig } from '../src/lib/prediction-v3'
import { runConfiguredModel, runEnsemble } from '../src/lib/prediction-suite'
import type { RaceEntryWithHorse } from '../src/lib/types'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })

interface CompletedRace {
  id: string
  race_datetime: string
  distance_m: number | null
  track_condition: string | null
  race_class: string | null
  racecourse_id: string
}

interface ModelOutcome extends BacktestOutcome {
  confidence: number
}

const supabase = createScriptClient()

async function loadCompletedRaces() {
  const races: CompletedRace[] = []
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await supabase
      .from('races')
      .select('id, race_datetime, distance_m, track_condition, race_class, racecourse_id')
      .eq('status', 'completed')
      .order('race_datetime', { ascending: true })
      .range(offset, offset + 999)
    if (error) throw error
    races.push(...((data ?? []) as CompletedRace[]))
    if (!data || data.length < 1_000) break
  }
  return races
}

async function loadEntries(raceIds: string[]) {
  const entries: RaceEntryWithHorse[] = []
  for (let offset = 0; offset < raceIds.length; offset += 40) {
    const { data, error } = await supabase
      .from('race_entries')
      .select('*, horses(*)')
      .in('race_id', raceIds.slice(offset, offset + 40))
    if (error) throw error
    entries.push(...((data ?? []) as RaceEntryWithHorse[]))
  }
  return entries
}

function historicalStart(entry: RaceEntryWithHorse, race: CompletedRace, fieldSize: number): HistoricalStart {
  return {
    raceId: race.id,
    horseId: entry.horse_id,
    racecourseId: race.racecourse_id,
    raceDatetime: race.race_datetime,
    distanceM: race.distance_m ?? undefined,
    trackCondition: race.track_condition ?? undefined,
    raceClass: race.race_class ?? undefined,
    finishingPosition: entry.finishing_position,
    fieldSize,
    finishingTime: entry.finishing_time,
    margin: entry.margin,
    barrier: entry.barrier_number,
    weight: entry.weight_carried,
    jockey: entry.jockey,
    trainer: entry.trainer,
  }
}

function metrics(outcomes: ModelOutcome[]) {
  const total = outcomes.length
  return {
    races: total,
    winnerAccuracy: outcomes.filter((outcome) => outcome.correctWinner).length / total,
    winnerTop3Accuracy: outcomes.filter((outcome) => outcome.winnerTop3).length / total,
    podiumOverlap: outcomes.reduce((sum, outcome) => sum + outcome.podiumOverlap, 0) / total,
    exactPodiumAccuracy: outcomes.filter((outcome) => outcome.correctPodium).length / total,
    orderedTrifectaAccuracy: outcomes.filter((outcome) => outcome.orderedTrifecta).length / total,
    brier: outcomes.reduce((sum, outcome) => sum + outcome.winnerBrierScore, 0) / total,
    logLoss: outcomes.reduce((sum, outcome) => sum + outcome.winnerLogLoss, 0) / total,
    averageConfidence: outcomes.reduce((sum, outcome) => sum + outcome.confidence, 0) / total,
  }
}

async function compareModels() {
  const races = await loadCompletedRaces()
  const entries = await loadEntries(races.map((race) => race.id))
  const entriesByRace = Map.groupBy(entries, (entry) => entry.race_id)
  const validRaces = races.filter((race) => {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    return field.length >= 4 && field.filter((entry) => entry.finishing_position === 1).length === 1
  })
  const splitIndex = Math.floor(validRaces.length * 0.7)
  const evaluationRaces = validRaces.slice(splitIndex)
  const firstEvaluationTime = new Date(evaluationRaces[0]?.race_datetime ?? 0).getTime()
  const history: HistoricalStart[] = validRaces.slice(0, splitIndex).flatMap((race) => {
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    return field.map((entry) => historicalStart(entry, race, field.length))
  })

  const configs: PredictionModelConfig[] = [
    ...Object.values(MODEL_CONFIGS),
    {
      version: 'experiment-recent-context',
      temperature: 2.2,
      weights: { ...MODEL_CONFIGS.contextual.weights, recentForm: 3.4, contextualForm: 4.2, trainerForm: 1.3, partnershipForm: 1.1 },
    },
    {
      version: 'experiment-balanced',
      temperature: 2.5,
      weights: { ...MODEL_CONFIGS.connections.weights, recentForm: 2.8, contextualForm: 3.8, jockeyForm: 1.2, trainerForm: 1.4, partnershipForm: 1.2 },
    },
  ]
  const outcomes = new Map<string, ModelOutcome[]>([
    ...configs.map((model) => [model.version, []] as [string, ModelOutcome[]]),
    ['experiment-ensemble-all', []],
    ['experiment-ensemble-context-connections', []],
    ['experiment-ensemble-optimized-connections', []],
    ['experiment-ensemble-optimized-baseline', []],
  ])

  for (const race of evaluationRaces) {
    const raceTime = new Date(race.race_datetime).getTime()
    const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
    const input = {
      race: {
        id: race.id,
        racecourseId: race.racecourse_id,
        raceDatetime: race.race_datetime,
        distanceM: race.distance_m ?? undefined,
        trackCondition: race.track_condition ?? undefined,
        raceClass: race.race_class ?? undefined,
      },
      entries: field,
      history: history.filter((start) => new Date(start.raceDatetime).getTime() < raceTime),
      fieldSize: field.length,
    }
    const configuredResults = configs.map((model) => runConfiguredModel(input, model))
    const results = [
      ...configuredResults,
      { ...runEnsemble(input, configs), modelVersion: 'experiment-ensemble-all' },
      { ...runEnsemble(input, [MODEL_CONFIGS.contextual, MODEL_CONFIGS.connections]), modelVersion: 'experiment-ensemble-context-connections' },
      { ...runEnsemble(input, [MODEL_CONFIGS.optimized, MODEL_CONFIGS.connections]), modelVersion: 'experiment-ensemble-optimized-connections' },
      { ...runEnsemble(input, [MODEL_CONFIGS.optimized, MODEL_CONFIGS.baseline]), modelVersion: 'experiment-ensemble-optimized-baseline' },
    ]

    for (const result of results) {
      const outcome = evaluatePrediction(
        result.predictions,
        result.predicted_times,
        field.map((entry) => ({
          horse_id: entry.horse_id,
          finishing_position: entry.finishing_position ?? null,
          finishing_time: entry.finishing_time ?? null,
        })),
      )
      if (outcome) outcomes.get(result.modelVersion)?.push({ ...outcome, confidence: result.confidence_scores.winner })
    }
    history.push(...field.map((entry) => historicalStart(entry, race, field.length)))
  }

  const report = [...outcomes].map(([model, modelOutcomes]) => ({ model, ...metrics(modelOutcomes) }))
    .sort((left, right) => right.winnerAccuracy - left.winnerAccuracy || right.winnerTop3Accuracy - left.winnerTop3Accuracy || left.logLoss - right.logLoss)

  console.log(JSON.stringify({
    totalValidRaces: validRaces.length,
    trainingRaces: splitIndex,
    evaluationRaces: evaluationRaces.length,
    evaluationFrom: new Date(firstEvaluationTime).toISOString(),
    report,
  }, null, 2))
}

compareModels().catch((error: unknown) => {
  console.error('Comparator failed', error)
  process.exitCode = 1
})
