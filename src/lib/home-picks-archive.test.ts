import { afterEach, expect, it, vi } from 'vitest'
import { homePicksArchive, recordHomePicks } from './home-picks-archive'
import type { HomeSnapshot } from './page-snapshot-loaders'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTabPricesForInternalRaces } from './paper-betting/internal-tab-odds'

vi.mock('./paper-betting/internal-tab-odds', () => ({ getTabPricesForInternalRaces: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

function selectionSnapshot(): HomeSnapshot {
  return { races: [{ id: 'race', race_number: 1, race_datetime: '2026-10-07T01:00:00Z', status: 'upcoming', racecourses: { name: 'Test' },
    prediction: { id: 'prediction', model_version: 'v6-market-blend', predicted_at: '2026-10-06T23:00:00Z', predictions: {
      podium: [{ horse_id: 'horse', horse_name: 'Runner (AUS)', win_probability: 0.6, top3_probability: 0.8 }], all_horses: [],
    } } }], tabRaceIds: ['race'], reliabilityByRace: { race: { score: 83, classification: 'Average', vetoReason: null } }, reliabilityAvailable: true } as unknown as HomeSnapshot
}

it('freezes the uncapped default home shortlist with recorded reliability, TAB eligibility and pre-start timing', () => {
  const observedAt = '2026-10-03T00:00:00Z'
  const snapshot = {
    races: Array.from({ length: 7 }, (_, index) => ({
      id: String(index), race_number: 1, race_datetime: index === 6 ? observedAt : '2026-10-03T07:45:00Z', status: 'upcoming',
      prediction: { id: `forecast-${index}`, model_version: 'v6-market-blend', predicted_at: '2026-10-02T20:06:52Z', predictions: {
        podium: [{ horse_id: `horse-${index}`, horse_name: 'Runner', win_probability: index === 4 ? 0.49 : 0.5 + index / 100, top3_probability: 0.64 }], all_horses: [],
      } },
    })),
    tabRaceIds: ['0', '1', '2', '3', '4', '6'], reliabilityAvailable: true,
    reliabilityByRace: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [String(index), { score: 83 - index, classification: 'Average', vetoReason: null }])),
  } as unknown as HomeSnapshot
  const archive = homePicksArchive(snapshot, observedAt, observedAt)
  expect(archive.picks.map(pick => pick.race.id)).toEqual(['3', '2', '1', '0'])
  expect(archive.picks[3]).toMatchObject({ winProbability: 0.5, top3Probability: 0.64, reliability: { score: 83 }, provenance: 'home-snapshot', predictionId: 'forecast-0' })
  expect(archive.picks[3].race.prediction).toBeNull()
  expect(archive.dateKeys).toEqual(['2026-10-03', '2026-10-04'])
})

it('stores insert-only archive generations, including genuinely empty shortlists', async () => {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const db = { from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient
  await recordHomePicks(db, { races: [], tabRaceIds: [], reliabilityByRace: {} }, '2026-10-05T00:00:00Z')
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'home-picks-v1:2026-10-05T00:00:00Z', payload: expect.objectContaining({ schema: 1, picks: [] }) }), { onConflict: 'kind', ignoreDuplicates: true })
})

it('stores TAB WIN and PLACE with timestamps on the selection archive, without changing the pick', async () => {
  vi.useFakeTimers().setSystemTime(new Date('2026-10-07T00:00:00Z'))
  const tabPrice = { win: 2.4, place: 1.3, capturedAt: '2026-10-06T23:59:30Z', quotedAt: '2026-10-06T23:59:20Z' }
  vi.mocked(getTabPricesForInternalRaces).mockResolvedValue(new Map([['race', new Map([['runner', tabPrice]])]]))
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const db = { from: () => ({ upsert }) } as unknown as SupabaseClient
  await recordHomePicks(db, selectionSnapshot(), '2026-10-06T23:59:50Z')
  expect(getTabPricesForInternalRaces).toHaveBeenCalledWith(db, [{ id: 'race', racecourseName: 'Test', raceNumber: 1, raceDatetime: '2026-10-07T01:00:00Z' }], false, '2026-10-07T00:00:00.000Z', 'selection')
  expect(upsert.mock.calls[0][0].payload.picks[0]).toMatchObject({ predictionId: 'prediction', winProbability: 0.6, tabPrice, tabPriceStatus: 'captured' })
  expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'kind', ignoreDuplicates: true })
})

it('archives a pick with explicit unavailability when TAB has no quote or the lookup fails', async () => {
  vi.useFakeTimers().setSystemTime(new Date('2026-10-07T00:00:00Z'))
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const db = { from: () => ({ upsert }) } as unknown as SupabaseClient
  vi.mocked(getTabPricesForInternalRaces).mockResolvedValueOnce(new Map()).mockRejectedValueOnce(new Error('Database unavailable'))
  await recordHomePicks(db, selectionSnapshot(), '2026-10-06T23:59:50Z')
  await recordHomePicks(db, selectionSnapshot(), '2026-10-06T23:59:51Z')
  expect(upsert.mock.calls[0][0].payload.picks[0]).toMatchObject({ tabPrice: null, tabPriceStatus: 'unavailable' })
  expect(upsert.mock.calls[1][0].payload.picks[0]).toMatchObject({ tabPrice: null, tabPriceStatus: 'lookup-failed' })
})