import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDailyPicksHistory } from './daily-picks-history'
import { candidatesForDate } from './daily-picks'
import { CURRENT_MODEL_VERSIONS, PRODUCTION_MODEL_VERSION } from './prediction-suite'

vi.mock('./daily-picks', () => ({ candidatesForDate: vi.fn(() => []), melbourneDateKey: () => '2026-09-22' }))

it('reads every forecast page and selects the newest retrospective model with deterministic ties', async () => {
  const forecasts = Array.from({ length: 251 }, (_, index) => ({
    id: String(index).padStart(4, '0'), race_id: 'race', model_version: `${PRODUCTION_MODEL_VERSION}-retrospective`,
    predicted_at: index === 0 || index === 250 ? '2026-09-22T00:00:00Z' : '2026-09-21T00:00:00Z',
    podium: [{ horse_id: `horse-${index}` }],
  }))
  const filters = vi.fn()
  const cursors = vi.fn()
  const db = { from: (table: string) => {
    let after: string | null = null
    let limit = 0
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      in: (column: string, values: string[]) => { filters(table, column, values); return query },
      gt: (column: string, value: string) => { after = value; cursors(table, column, value); return query },
      limit: (value: number) => { limit = value; return query },
      then: (resolve: (value: unknown) => unknown) => {
        const rows = table === 'races' ? [{ id: 'race', race_datetime: '2026-09-22T01:00:00Z' }]
          : table === 'predictions' ? forecasts : []
        return Promise.resolve({ data: rows.filter(row => !after || row.id > after).slice(0, limit), error: null }).then(resolve)
      },
    }
    return query
  } } as unknown as SupabaseClient
  await loadDailyPicksHistory(db, { days: 7 })
  expect(cursors).toHaveBeenCalledWith('predictions', 'id', '0249')
  expect(filters).toHaveBeenCalledWith('predictions', 'model_version', CURRENT_MODEL_VERSIONS.map(version => `${version}-retrospective`))
  const races = vi.mocked(candidatesForDate).mock.calls[0][0]
  expect(races[0].model_predictions).toHaveLength(1)
  expect(races[0].prediction?.id).toBe('0250')
})