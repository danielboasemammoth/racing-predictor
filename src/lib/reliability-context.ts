import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyRaceType, barrierThird as computeBarrierThird, marketImpliedProbability, modelEdge, modelEdgeBand } from '@/lib/reliability-analysis'
import { computeReliabilityScore, type CalibrationTable, type ReliabilityResult } from '@/lib/reliability-score'
import { findSimilarRaces, type HistoricalRaceFeatures, type SimilarRacesResult } from '@/lib/similar-races'
import { extractBestWinOdds, flatStakeReport } from '@/lib/roi-analysis'
import type { Prediction, RaceEntryWithHorse } from '@/lib/types'

interface HistoryPayload {
  rows: HistoricalRaceFeatures[]
}

export interface ReliabilityContext {
  calibration: CalibrationTable
  history: HistoricalRaceFeatures[]
}

/** Loads the latest published calibration table + historical feature rows (see scripts/reliability-analysis.ts). */
export async function loadReliabilityContext(supabase: SupabaseClient): Promise<ReliabilityContext | null> {
  const { data, error } = await supabase
    .from('analysis_snapshots')
    .select('kind, payload')
    .in('kind', ['reliability-calibration', 'race-feature-history'])
  if (error || !data?.length) return null

  const calibration = data.find((row) => row.kind === 'reliability-calibration')?.payload as CalibrationTable | undefined
  const history = (data.find((row) => row.kind === 'race-feature-history')?.payload as HistoryPayload | undefined)?.rows
  if (!calibration || !history) return null

  return { calibration, history }
}

export interface RaceReliability {
  reliability: ReliabilityResult
  similarRaces: SimilarRacesResult
  modelEdge: RaceModelEdge | null
}

export interface RaceModelEdge {
  bestRecordedOdds: number
  marketImpliedProbability: number
  edge: number
  edgeBand: string
  /** Historical ROI for this edge band - NOT the same signal as Reliability, deliberately kept separate (see spec section 29). */
  historicalRoi: { roi: number; bets: number } | null
}

/** Computes the Reliability Score and Similar Historical Races summary for a race's top prediction. */
export function computeRaceReliability(
  race: { distance_m: number | null; race_class: string | null; track_condition: string | null },
  entries: RaceEntryWithHorse[],
  primaryPrediction: Prediction | null,
  siblingPredictions: Prediction[],
  context: ReliabilityContext,
): RaceReliability | null {
  const predictedWinner = primaryPrediction?.predictions.podium[0]
  if (!predictedWinner) return null

  const second = primaryPrediction.predictions.podium[1]
  const probability = predictedWinner.win_probability ?? predictedWinner.confidence
  const secondProbability = second ? (second.win_probability ?? second.confidence) : 0
  const gap = Math.max(0, probability - secondProbability)

  const otherModels = siblingPredictions.filter((prediction) => prediction.model_version !== primaryPrediction.model_version)
  const agreeing = otherModels.filter((prediction) => prediction.predictions.podium[0]?.horse_id === predictedWinner.horse_id).length

  const barrier = entries.find((entry) => entry.horse_id === predictedWinner.horse_id)?.barrier_number
  const barrierThird = barrier ? computeBarrierThird(barrier, entries.length) : null
  const raceType = classifyRaceType(race.race_class)

  const reliability = computeReliabilityScore(
    { probability, gap, agreeing, totalBaseModels: otherModels.length },
    context.calibration,
    context.history,
  )
  const similarRaces = findSimilarRaces(
    {
      distanceM: race.distance_m,
      raceType,
      fieldSize: entries.length,
      trackCondition: race.track_condition,
      barrierThird,
    },
    context.history,
  )

  const bestRecordedOdds = extractBestWinOdds(entries.find((entry) => entry.horse_id === predictedWinner.horse_id)?.sectional_times)
  const modelEdgeResult = bestRecordedOdds ? computeModelEdge(probability, bestRecordedOdds, context.history) : null

  return { reliability, similarRaces, modelEdge: modelEdgeResult }
}

function computeModelEdge(probability: number, bestRecordedOdds: number, history: HistoricalRaceFeatures[]): RaceModelEdge {
  const impliedProbability = marketImpliedProbability(bestRecordedOdds)
  const edge = modelEdge(probability, impliedProbability)
  const edgeBand = modelEdgeBand(edge)

  const comparableBets = history.filter(
    (r): r is HistoricalRaceFeatures & { bestRecordedOdds: number; probability: number } =>
      Boolean(r.bestRecordedOdds) && typeof r.probability === 'number'
      && modelEdgeBand(modelEdge(r.probability, marketImpliedProbability(r.bestRecordedOdds!))) === edgeBand,
  )
  const historicalRoi = comparableBets.length >= 5
    ? { roi: flatStakeReport(comparableBets.map((r) => ({ won: r.correctWinner, odds: r.bestRecordedOdds }))).roi, bets: comparableBets.length }
    : null

  return { bestRecordedOdds, marketImpliedProbability: impliedProbability, edge, edgeBand, historicalRoi }
}
