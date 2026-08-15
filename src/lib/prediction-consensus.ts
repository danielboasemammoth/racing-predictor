import type { RaceEntryWithHorse } from '@/lib/types'
import { predictByBarrier, predictByCondition, predictByForm } from '@/lib/prediction-models'
import { predictContextualRace, type HistoricalStart } from '@/lib/prediction-v3'

export interface ConsensusInput {
  race: {
    id: string
    racecourseId: string
    raceDatetime: string
    distanceM?: number
    trackCondition?: string
    raceClass?: string
  }
  entries: RaceEntryWithHorse[]
  history: HistoricalStart[]
  oddsByHorse?: Record<string, { win?: number; place?: number }>
  fieldSize?: number
}

export function predictConsensusRace(input: ConsensusInput) {
  const contextual = predictContextualRace({
    race: input.race,
    entries: input.entries,
    history: input.history,
    oddsByHorse: input.oddsByHorse,
    fieldSize: input.fieldSize,
  })

  const crossChecks = [
    predictByForm(input.entries),
    predictByBarrier(input.entries, input.race.trackCondition),
    predictByCondition(input.entries, input.race.trackCondition),
  ]

  const contextualWinner = contextual.predictions.podium[0]?.horse_id
  const agreementCount = crossChecks.filter((model) => model.predictions.podium[0]?.horse_id === contextualWinner).length

  const baseWinnerConfidence = contextual.confidence_scores.winner ?? contextual.predictions.podium[0]?.confidence ?? 0
  const agreementBoost = agreementCount * 0.05
  const adjustedWinnerConfidence = Math.min(baseWinnerConfidence + agreementBoost, 0.95)

  const crossCheckPodiums = crossChecks.map((model) => model.predictions.podium.map((p) => p.horse_id))

  return {
    model: 'v3.2-consensus',
    predictions: contextual.predictions,
    confidence_scores: {
      overall: adjustedWinnerConfidence,
      winner: adjustedWinnerConfidence,
      podium: contextual.confidence_scores.podium,
    },
    predicted_times: contextual.predicted_times,
    meta: {
      base_model: 'v3.1-contextual-ranking',
      cross_check_models: crossChecks.map((m) => m.name),
      cross_check_winner_agreement: agreementCount,
      cross_check_podiums: crossCheckPodiums,
      contextual_winner: contextualWinner,
      disagreement_flag: agreementCount === 0,
      confidence_boost: agreementBoost,
    },
  }
}
