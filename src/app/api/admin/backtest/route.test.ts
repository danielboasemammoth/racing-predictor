import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { POST } from './route'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: vi.fn(async () => true) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

it('scores only the newest forecast while retaining stored outcomes for historical models', async () => {
  const podium = [{ horse_id: 'winner', confidence: 0.5 }]
  const base = { race_id: 'race', confidence_scores: { overall: 0.5 }, podium, predicted_times: {}, all_horses: [] }
  const forecasts = [
    { ...base, id: 'a', model_version: 'current', predicted_at: '2026-09-20', actual_results: null },
    { ...base, id: 'b', model_version: 'current', predicted_at: '2026-09-21', actual_results: null },
    { ...base, id: 'c', model_version: 'current', predicted_at: '2026-09-21', actual_results: null },
    { ...base, id: 'd', model_version: 'historical', predicted_at: '2026-09-20', actual_results: { podium: ['winner'], winner_top3: true } },
  ]
  const fullFetches: string[][] = []
  const updates: string[] = []
  const logs: Array<{ model_version: string; total_races: number }> = []
  const db = { from: (table: string) => {
    let ids: string[] | null = null
    let updateId: string | null = null
    let updating = false
    const query = {
      select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(),
      in: (column: string, values: string[]) => {
        if (column === 'id') { ids = values; fullFetches.push(values) }
        return query
      },
      update: () => { updating = true; return query },
      eq: (column: string, value: string) => { if (column === 'id') updateId = value; return query },
      upsert: (row: typeof logs[number]) => { logs.push(row); return Promise.resolve({ error: null }) },
      then: (resolve: (value: unknown) => unknown) => {
        if (updating && updateId) updates.push(updateId)
        const data = table === 'races' ? [{ id: 'race', race_datetime: '2026-09-22T00:00:00Z' }]
          : table === 'race_entries' ? [{ id: 'entry', race_id: 'race', horse_id: 'winner', finishing_position: 1, finishing_time: 70 }]
          : updating ? [] : forecasts.filter(row => !ids || ids.includes(row.id))
        return Promise.resolve({ data, error: null }).then(resolve)
      },
    }
    return query
  } } as unknown as SupabaseClient
  vi.mocked(createAdminClient).mockReturnValue(db)
  const response = await POST()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ success: true, scored: 2, models: 2 })
  expect(fullFetches).toEqual([['c']])
  expect(updates).toEqual(['c'])
  expect(logs.map(row => [row.model_version, row.total_races])).toEqual([['current', 1], ['historical', 1]])
})