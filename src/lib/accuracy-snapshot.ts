import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccuracyLog } from './types'
import { withSupabaseReadRetry } from './supabase/read-retry'

interface ScoredPredictionRow {
  id: string
  model_version: string
  predicted_winner_id: string | null
  predicted_win_probability: string | null
  predicted_confidence: string | null
  actual_winner_id: string | null
  winner_top3: string | null
  podium_overlap: string | null
  ordered_trifecta: string | null
  winner_brier_score: string | null
  winner_log_loss: string | null
}

export async function loadAccuracySnapshot(db: SupabaseClient) {
  const logs = await db.from('accuracy_log').select('*').order('period_end', { ascending: false }).limit(30)
  if (logs.error) throw logs.error
  const data: ScoredPredictionRow[] = []
  let lastId: string | null = null
  for (;;) {
    let query = db.from('predictions').select(`
      id, model_version,
      predicted_winner_id:predictions->podium->0->>horse_id,
      predicted_win_probability:predictions->podium->0->>win_probability,
      predicted_confidence:predictions->podium->0->>confidence,
      actual_winner_id:actual_results->podium->>0,
      winner_top3:actual_results->>winner_top3,
      podium_overlap:actual_results->>podium_overlap,
      ordered_trifecta:actual_results->>ordered_trifecta,
      winner_brier_score:actual_results->>winner_brier_score,
      winner_log_loss:actual_results->>winner_log_loss
    `).not('actual_results', 'is', null).order('id').limit(250)
    if (lastId) query = query.gt('id', lastId)
    const response = await withSupabaseReadRetry(() => query)
    if (response.error) throw response.error
    const rows = (response.data ?? []) as unknown as ScoredPredictionRow[]
    data.push(...rows)
    if (rows.length < 250) break
    lastId = rows[rows.length - 1].id
  }
  const modelMetrics = [...Map.groupBy(data, prediction => prediction.model_version)].map(([modelVersion, predictions]) => {
    const valid = predictions.filter(prediction => prediction.actual_winner_id !== null)
    const probability = (prediction: ScoredPredictionRow) => Number(prediction.predicted_win_probability ?? prediction.predicted_confidence ?? 0)
    const average = (value: (prediction: ScoredPredictionRow) => number) => valid.length ? valid.reduce((sum, prediction) => sum + value(prediction), 0) / valid.length : 0
    const calibration = Map.groupBy(valid, prediction => Math.min(90, Math.floor(probability(prediction) * 10) * 10))
    return {
      modelVersion, races: valid.length,
      winnerAccuracy: average(prediction => Number(prediction.predicted_winner_id === prediction.actual_winner_id)),
      winnerTop3Accuracy: average(prediction => Number(prediction.winner_top3 === 'true')),
      podiumOverlap: average(prediction => Number(prediction.podium_overlap ?? 0)),
      trifectaAccuracy: average(prediction => Number(prediction.ordered_trifecta === 'true')),
      brierScore: average(prediction => Number(prediction.winner_brier_score ?? 0)),
      logLoss: average(prediction => Number(prediction.winner_log_loss ?? 0)),
      calibration: [...calibration].sort(([left], [right]) => left - right).map(([band, bucket]) => ({
        band, races: bucket.length,
        predicted: bucket.reduce((sum, prediction) => sum + probability(prediction), 0) / bucket.length,
        observed: bucket.filter(prediction => prediction.predicted_winner_id === prediction.actual_winner_id).length / bucket.length,
      })),
    }
  }).filter(metric => metric.races > 0).sort((left, right) => right.races - left.races)
  return { logs: (logs.data ?? []) as AccuracyLog[], modelMetrics }
}

export type AccuracySnapshot = Awaited<ReturnType<typeof loadAccuracySnapshot>>