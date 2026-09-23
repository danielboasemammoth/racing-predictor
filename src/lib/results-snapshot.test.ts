import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadResultsSnapshot } from './results-snapshot'
import { PRODUCTION_MODEL_VERSION } from './prediction-suite'

it('prefers the latest retrospective production prediction over newer live and challenger rows', async () => {
  const horse = { horse_id: 'winner', horse_name: 'Winner', predicted_position: 1, confidence: 0.5 }
  const latest = { id: 'production', race_id: 'race', model_version: `${PRODUCTION_MODEL_VERSION}-retrospective`, predicted_at: '2026-09-21T04:00:00Z', predictions: { all_horses: [horse] }, confidence_scores: { winner: 0.5 } }
  const records: Record<string, unknown[]> = {
    races: [{ id: 'race', race_datetime: '2026-09-21T03:00:00Z', racecourses: { name: 'Flemington' } }],
    race_entries: [], predictions: [
      { ...latest, id: 'live', model_version: PRODUCTION_MODEL_VERSION, predicted_at: '2026-09-21T06:00:00Z' },
      { ...latest, id: 'challenger', model_version: 'v4.1-ensemble-retrospective', predicted_at: '2026-09-21T05:00:00Z' },
      latest,
      { ...latest, id: 'older', predicted_at: '2026-09-21T02:00:00Z' },
    ],
  }
  const db = { from: vi.fn((table: string) => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: records[table], error: null }).then(resolve) }
    return query
  }) } as unknown as SupabaseClient
  const snapshot = await loadResultsSnapshot(db)
  expect(snapshot.races[0].racecourseName).toBe('Flemington')
  expect(snapshot.predictions).toEqual([{ ...latest, predictions: { podium: [horse], all_horses: [] } }])
})