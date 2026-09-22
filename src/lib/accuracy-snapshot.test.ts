import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAccuracySnapshot } from './accuracy-snapshot'

it('paginates at the API row cap and computes the same metrics across pages', async () => {
  const row = { id: 'last-id', model_version: 'model', predicted_winner_id: 'winner', actual_winner_id: 'winner',
    predicted_win_probability: '0.5', winner_top3: 'true', podium_overlap: '2', ordered_trifecta: 'false', winner_brier_score: '0.25', winner_log_loss: '0.693' }
  const responses = [{ data: Array.from({ length: 250 }, () => row), error: null }, { data: [{ ...row, actual_winner_id: 'other' }], error: null }]
  const predictionQuery = { select: vi.fn().mockReturnThis(), not: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(responses.shift()).then(resolve) }
  const logsQuery = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) }
  const db = { from: vi.fn(table => table === 'accuracy_log' ? logsQuery : predictionQuery) } as unknown as SupabaseClient
  const snapshot = await loadAccuracySnapshot(db)
  expect(predictionQuery.limit).toHaveBeenCalledWith(250)
  expect(predictionQuery.gt).toHaveBeenCalledWith('id', 'last-id')
  expect(snapshot.modelMetrics[0]).toMatchObject({ races: 251, winnerAccuracy: 250 / 251, winnerTop3Accuracy: 1, podiumOverlap: 2, trifectaAccuracy: 0, brierScore: 0.25 })
  expect(snapshot.modelMetrics[0].calibration).toEqual([{ band: 50, races: 251, predicted: 0.5, observed: 250 / 251 }])
})