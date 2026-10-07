import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTabPricesForInternalRaces } from './internal-tab-odds'

const races = [{ id: 'internal', racecourseName: 'Test', raceNumber: 1, raceDatetime: '2026-09-01T01:00:00Z' }]
const capture = (captured_at: string, tab_age_seconds: number | null, price: number) => ({ id: captured_at, runner_id: 'runner', captured_at, tab_age_seconds, tab_win_price: price, tab_place_price: 2 })
function fixture(snapshots: ReturnType<typeof capture>[], duplicate = false) {
  const from = vi.fn((table: string) => {
    const data = table === 'pe_races' ? [{ id: 'pe', venue: 'Test', race_number: 1, start_time: races[0].raceDatetime }]
      : table === 'pe_runners' ? [{ id: 'runner', race_id: 'pe', name: 'Horse (AUS)' }, ...(duplicate ? [{ id: 'other', race_id: 'pe', name: 'Horse' }] : [])] : snapshots
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(), retry: vi.fn().mockResolvedValue({ data, error: null }) }
    return query
  })
  return { from } as unknown as SupabaseClient
}

it('uses the latest fresh pre-start TAB quote, never stale or post-start observations', async () => {
  const db = fixture([capture('2026-09-01T01:01:00Z', 0, 99), capture('2026-09-01T00:59:00Z', 600, 88), capture('2026-09-01T00:58:00Z', 30, 3), capture('2026-09-01T00:55:00Z', 10, 4)])
  expect((await getTabPricesForInternalRaces(db, races, true)).get('internal')?.get('horse')).toEqual({ win: 3, place: 2, capturedAt: '2026-09-01T00:58:00Z', quotedAt: '2026-09-01T00:57:30.000Z' })
})

it('does not use unknown-age, old or ambiguous runner quotes', async () => {
  expect((await getTabPricesForInternalRaces(fixture([capture('2026-09-01T00:58:00Z', null, 3), capture('2026-09-01T00:40:00Z', 0, 4)]), races, true)).size).toBe(0)
  expect((await getTabPricesForInternalRaces(fixture([capture('2026-09-01T00:58:00Z', 0, 3)], true), races, true)).size).toBe(0)
})

it('retains the existing live prediction lookup mode', async () => {
  expect((await getTabPricesForInternalRaces(fixture([capture('2026-09-01T00:40:00Z', null, 4)]), races)).get('internal')?.get('horse')?.win).toBe(4)
})

it('uses the latest fresh quote available at the decision, not a later or better historical price', async () => {
  const db = fixture([capture('2026-09-01T00:31:00Z', 0, 99), capture('2026-09-01T00:29:30Z', 20, 3), capture('2026-09-01T00:29:00Z', 0, 10)])
  expect((await getTabPricesForInternalRaces(db, races, false, '2026-09-01T00:30:00Z')).get('internal')?.get('horse')).toMatchObject({ win: 3, quotedAt: '2026-09-01T00:29:10.000Z' })
  for (const snapshot of [capture('2026-09-01T00:28:00Z', 1, 3), capture('2026-09-01T00:29:30Z', null, 3)]) {
    expect((await getTabPricesForInternalRaces(fixture([snapshot]), races, false, '2026-09-01T00:30:00Z')).size).toBe(0)
  }
  expect((await getTabPricesForInternalRaces(fixture([capture('2026-09-01T00:29:30Z', 0, 3)], true), races, false, '2026-09-01T00:30:00Z')).size).toBe(0)
})

it('freezes quotes at early selection time without borrowing later prices or relaxing freshness', async () => {
  const selectedAt = '2026-08-31T20:00:00Z'
  const snapshots = [capture('2026-09-01T00:59:00Z', 0, 99), capture('2026-08-31T19:59:30Z', 20, 3)]
  expect((await getTabPricesForInternalRaces(fixture(snapshots), races, false, selectedAt, 'selection')).get('internal')?.get('horse'))
    .toMatchObject({ win: 3, place: 2, capturedAt: '2026-08-31T19:59:30Z', quotedAt: '2026-08-31T19:59:10.000Z' })
  expect((await getTabPricesForInternalRaces(fixture(snapshots), races, false, selectedAt)).size).toBe(0)
  for (const snapshot of [capture('2026-08-31T19:57:00Z', 0, 4), capture('2026-08-31T19:59:30Z', null, 4), capture('2026-08-31T20:00:01Z', 0, 4)]) {
    expect((await getTabPricesForInternalRaces(fixture([snapshot]), races, false, selectedAt, 'selection')).size).toBe(0)
  }
  expect((await getTabPricesForInternalRaces(fixture([capture('2026-09-01T01:00:00Z', 0, 3)]), races, false, races[0].raceDatetime, 'selection')).size).toBe(0)
})