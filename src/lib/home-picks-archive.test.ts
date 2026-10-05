import { expect, it, vi } from 'vitest'
import { homePicksArchive, recordHomePicks } from './home-picks-archive'
import type { HomeSnapshot } from './page-snapshot-loaders'
import type { SupabaseClient } from '@supabase/supabase-js'

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