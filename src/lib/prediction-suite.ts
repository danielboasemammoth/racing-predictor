import type { PredictedHorse, PredictionPayload } from '@/lib/types'
import {
  MODEL_CONFIGS,
  predictContextualRace,
  type ContextualPredictionInput,
  type ContextualPredictionResult,
  type PredictionModelConfig,
} from '@/lib/prediction-v3'

export interface ModelSuiteResult extends ContextualPredictionResult {
  modelVersion: string
}

export const ALL_MODEL_CONFIGS = Object.values(MODEL_CONFIGS)
export const PRODUCTION_ENSEMBLE_CONFIGS = [MODEL_CONFIGS.optimized, MODEL_CONFIGS.connections]
export const CURRENT_MODEL_VERSIONS = [...Object.values(MODEL_CONFIGS).map((config) => config.version), 'v4.1-ensemble']

function component(modelVersion: string, result: ContextualPredictionResult) {
  const winner = result.predictions.podium[0]
  if (!winner) return null
  return {
    model_version: modelVersion,
    winner_horse_id: winner.horse_id,
    winner_horse_name: winner.horse_name,
    winner_confidence: winner.win_probability ?? winner.confidence,
    podium_horse_ids: result.predictions.podium.map((horse) => horse.horse_id),
  }
}

export function runConfiguredModel(input: ContextualPredictionInput, config: PredictionModelConfig): ModelSuiteResult {
  const result = predictContextualRace(input, config)
  const modelComponent = component(config.version, result)
  return {
    ...result,
    modelVersion: config.version,
    predictions: {
      ...result.predictions,
      model_components: modelComponent ? [modelComponent] : [],
    },
  }
}

function ensembleTrifecta(podium: PredictedHorse[]) {
  const first = podium[0]?.win_probability ?? 0
  const second = podium[1]?.win_probability ?? 0
  const third = podium[2]?.win_probability ?? 0
  const firstSecond = first < 1 ? first * second / (1 - first) : 0
  const probability = first + second < 1 ? firstSecond * third / (1 - first - second) : 0
  return {
    horse_ids: podium.map((horse) => horse.horse_id),
    horse_names: podium.map((horse) => horse.horse_name),
    probability,
    fair_return_10: probability > 0 ? 10 / probability : 0,
    likelihood: probability >= 0.05 ? 'high' as const : probability >= 0.02 ? 'medium' as const : 'low' as const,
    notable_value: probability >= 0.02 && 10 / probability >= 100,
  }
}

export function runEnsemble(
  input: ContextualPredictionInput,
  configs: PredictionModelConfig[] = PRODUCTION_ENSEMBLE_CONFIGS,
): ModelSuiteResult {
  const components = configs.map((config) => runConfiguredModel(input, config))
  if (!components.length) return runConfiguredModel(input, MODEL_CONFIGS.baseline)

  const horseProbabilities = new Map<string, { horse: PredictedHorse; win: number; top3: number; count: number }>()
  for (const result of components) {
    for (const horse of result.predictions.all_horses) {
      const current = horseProbabilities.get(horse.horse_id) ?? { horse, win: 0, top3: 0, count: 0 }
      current.win += horse.win_probability ?? horse.confidence
      current.top3 += horse.top3_probability ?? 0
      current.count += 1
      horseProbabilities.set(horse.horse_id, current)
    }
  }

  const allHorses = [...horseProbabilities.values()]
    .map(({ horse, win, top3, count }) => ({
      ...horse,
      win_probability: win / count,
      top3_probability: top3 / count,
      confidence: win / count,
    }))
    .sort((left, right) => (right.win_probability ?? 0) - (left.win_probability ?? 0) || left.horse_name.localeCompare(right.horse_name))
    .map((horse, index) => ({ ...horse, predicted_position: index + 1 }))
  const podium = allHorses.slice(0, 3)
  const primary = components[0]
  const winnerVotes = components.filter((result) => result.predictions.podium[0]?.horse_id === podium[0]?.horse_id).length
  const predictions: PredictionPayload = {
    ...primary.predictions,
    podium,
    all_horses: allHorses,
    trifecta: ensembleTrifecta(podium),
    model_components: components.flatMap((result) => result.predictions.model_components ?? []),
    model_agreement: {
      winner_votes: winnerVotes,
      model_count: components.length,
      unanimous: winnerVotes === components.length,
    },
  }
  const winner = podium[0]?.win_probability ?? 0

  return {
    modelVersion: 'v4.1-ensemble',
    predictions,
    confidence_scores: {
      overall: winner,
      winner,
      podium: podium.reduce((sum, horse) => sum + (horse.top3_probability ?? 0), 0) / Math.max(podium.length, 1),
    },
    predicted_times: primary.predicted_times,
  }
}
