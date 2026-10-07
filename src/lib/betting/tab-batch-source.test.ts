import { afterEach, expect, it, vi } from 'vitest'
import { loadTabBatchPreview, mapTabBatchRace } from './tab-batch-source'
import { getUpcomingRaces } from '../upcoming-races'
import { picksHistoryPreset } from './simulation-presets'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../upcoming-races', () => ({ getUpcomingRaces: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

const detail = { meeting: { meetingName: 'GEELONG', meetingDate: '2026-10-07', raceType: 'R', venueMnemonic: 'GEL', sellCode: { meetingCode: 'M', scheduledType: 'R' } },
  raceNumber: 8, raceStartTime: '2026-10-07T08:00:00Z', raceStatus: 'Normal', pools: [{ wageringProduct: 'Win', poolStatusCode: 'Open' }, { wageringProduct: 'Place', poolStatusCode: 'Closed' }],
  runners: [{ runnerNumber: 1, runnerName: 'Runner', parimutuel: { bettingStatus: 'Open' }, fixedOdds: { bettingStatus: 'Open', returnWin: 3 } },
    { runnerNumber: 2, runnerName: 'Scratched', parimutuel: { bettingStatus: 'Scratched' } }] }

it('uses the daily jurisdiction sell code rather than the venue mnemonic or barrier', () => {
  expect(mapTabBatchRace('internal', detail, '2026-10-07')).toMatchObject({ code: 'MR', number: 8, winOpen: true, placeOpen: false,
    runners: [{ number: 1, name: 'Runner', open: true }, { number: 2, name: 'Scratched', open: false }] })
})

it('rejects wrong-day, abandoned, missing-code and duplicated-runner responses', () => {
  expect(() => mapTabBatchRace('race', detail, '2026-10-08')).toThrow()
  expect(() => mapTabBatchRace('race', { ...detail, raceStatus: 'Abandoned' }, '2026-10-07')).toThrow()
  expect(() => mapTabBatchRace('race', { ...detail, meeting: { ...detail.meeting, sellCode: undefined } }, '2026-10-07')).toThrow()
  expect(() => mapTabBatchRace('race', { ...detail, runners: [...detail.runners, ...detail.runners] }, '2026-10-07')).toThrow()
})

it('loads the earliest archived horse and original forecast without taking a later pick or changing stakes', async () => {
  vi.useFakeTimers().setSystemTime(new Date('2026-10-07T07:00:00Z'))
  const horse = { horse_id: 'horse', horse_name: 'Runner', predicted_position: 1, win_probability: 0.6, top3_probability: 0.8, win_odds: 3, place_odds: 2 }
  const prediction = { id: 'original', race_id: 'race', model_version: 'model', predicted_at: '2026-10-07T06:00:00Z', created_at: '2026-10-07T06:00:01Z', predictions: { podium: [horse], all_horses: [horse] } }
  const race = { id: 'race', race_number: 8, race_datetime: detail.raceStartTime, status: 'upcoming', racecourses: { name: 'Geelong', state: 'VIC' }, prediction, model_predictions: [prediction] }
  vi.mocked(getUpcomingRaces).mockResolvedValue([race] as never)
  const pick = { race, horse, observedAt: '2026-10-07T06:01:00Z', predictionId: 'original', provenance: 'home-snapshot', winProbability: 0.6, top3Probability: 0.8 }
  const reads: string[][] = []
  const db = { from: (table: string) => {
    const query = { select: vi.fn().mockReturnThis(), like: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      in: (_column: string, ids: string[]) => { reads.push(ids); return Promise.resolve({ data: table === 'predictions' ? [prediction] : [], error: null }) },
      limit: () => Promise.resolve({ data: table === 'race_entries' ? [{ horse_id: 'horse', status: 'active' }] : [
        { payload: { schema: 1, picks: [pick] } }, { payload: { schema: 1, picks: [{ ...pick, predictionId: 'later' }] } },
      ], error: null }),
    }; return query
  } } as unknown as SupabaseClient
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => Response.json(String(input).includes('/races/') ? detail : { meetings: [{ ...detail.meeting,
    races: [{ raceNumber: 8, raceStartTime: detail.raceStartTime, raceStatus: 'Normal', hasParimutuel: true }] }] }))
  const preview = await loadTabBatchPreview(db, picksHistoryPreset(), 'NSW', fetcher)
  expect(preview.text).toBe('MR-08-WP-00010.0-00000.0/1/')
  expect(reads).toContainEqual(['original'])
  expect(reads.flat()).not.toContain('later')
  expect(fetcher.mock.calls.every(call => String(call[0]).endsWith('jurisdiction=NSW'))).toBe(true)
  expect(preview.rows[0].model).toBe('model')
})