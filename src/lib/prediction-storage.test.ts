import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { insertPredictionSnapshots, type PredictionSnapshotRow } from './prediction-storage'

it('persists every forecast in small sequential batches without mutating the snapshots', async () => {
  const rows = Array.from({ length: 47 }, (_, index) => ({ race_id: `race-${index}`, model_version: 'model',
    predictions: { podium: [] }, confidence_scores: {}, predicted_times: {}, predicted_at: '2026-09-22T00:00:00Z' }))
  const insert = vi.fn().mockResolvedValue({ error: null })
  const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
  await insertPredictionSnapshots(db, rows)
  expect(insert.mock.calls.map(([batch]) => batch.length)).toEqual([20, 20, 7])
  expect(insert.mock.calls.flatMap(([batch]) => batch)).toEqual(rows)
})

it('stops on an ambiguous write failure without retrying or deleting prior forecasts', async () => {
  const error = { code: '57014' }
  const insert = vi.fn().mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error })
  const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
  await expect(insertPredictionSnapshots(db, Array.from({ length: 60 }, () => ({}) as PredictionSnapshotRow))).rejects.toEqual(error)
  expect(insert).toHaveBeenCalledTimes(2)
})