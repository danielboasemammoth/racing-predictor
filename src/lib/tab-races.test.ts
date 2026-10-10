import { expect, it, vi } from 'vitest'
import { getTabRaceIds, getTabScheduledRaces } from './tab-races'
import type { RaceWithPrediction } from './types'

const start = '2026-09-26T05:00:00Z'
const makeRace = (id: string, venue: string, raceNumber = 1, raceDatetime = start) => ({
  id, racecourses: { name: venue }, race_number: raceNumber, race_datetime: raceDatetime,
}) as RaceWithPrediction
const tabRace = (raceNumber: number, overrides = {}) => ({
  raceNumber, raceStartTime: start, raceStatus: 'Normal', hasParimutuel: false,
  hasFixedOdds: false, willHaveFixedOdds: true, ...overrides,
})

it('keeps TAB-listed races before prices arrive and excludes unlisted, abandoned and other-code races', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ meetings: [
    { meetingName: 'MORNINGTON', venueMnemonic: 'MOR', raceType: 'R', races: [
      tabRace(1), tabRace(2, { willHaveFixedOdds: false, hasParimutuel: true }),
      tabRace(3, { raceStatus: 'Abandoned' }), tabRace(4, { willHaveFixedOdds: false }),
      tabRace(5, { willHaveFixedOdds: false, hasFixedOdds: true }),
    ] },
    { meetingName: 'HARNESS', venueMnemonic: 'HAR', raceType: 'H', races: [tabRace(1)] },
  ] }))
  const races = [makeRace('early', 'Mornington'), makeRace('tote', 'Mornington', 2),
    makeRace('abandoned', 'Mornington', 3), makeRace('no-market', 'Mornington', 4),
    makeRace('fixed', 'Mornington', 5), makeRace('non-tab', 'Other'), makeRace('harness', 'Harness'),
    makeRace('wrong-number', 'Mornington', 6, '2026-09-26T07:00:00Z')]
  expect(await getTabRaceIds(races, fetcher)).toEqual(['early', 'tote', 'fixed'])
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('loads each Melbourne date including tomorrow', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ meetings: [] }))
  await getTabRaceIds([makeRace('today', 'Mornington'), makeRace('tomorrow', 'Mornington', 1, '2026-09-26T15:00:00Z')], fetcher)
  expect(fetcher.mock.calls.map(call => call[0])).toEqual([
    'https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/2026-09-26/meetings?jurisdiction=VIC',
    'https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/2026-09-27/meetings?jurisdiction=VIC',
  ])
})

it('rejects failed or malformed schedules instead of treating them as no TAB races', async () => {
  const races = [makeRace('today', 'Mornington')]
  await expect(getTabRaceIds(races, vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })))).rejects.toThrow('TAB schedule unavailable')
  await expect(getTabRaceIds(races, vi.fn<typeof fetch>().mockResolvedValue(Response.json({})))).rejects.toThrow('Invalid TAB schedule')
})

it('does not request a schedule for an empty race list', async () => {
  const fetcher = vi.fn<typeof fetch>()
  expect(await getTabRaceIds([], fetcher)).toEqual([])
  expect(fetcher).not.toHaveBeenCalled()
})

it('uses the revised TAB start for delayed Queensland races during southern daylight saving without mutating stored races', async () => {
  const race = makeRace('delayed', 'Eagle Farm', 6, '2026-10-10T14:43:00+10:00')
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ meetings: [
    { meetingName: 'EAGLE FARM', venueMnemonic: 'EAG', raceType: 'R', races: [
      tabRace(6, { raceStartTime: '2026-10-10T05:20:00Z' }),
    ] },
  ] }))
  expect(await getTabScheduledRaces([race], fetcher)).toEqual([{ ...race, race_datetime: '2026-10-10T05:20:00Z' }])
  expect(race.race_datetime).toBe('2026-10-10T14:43:00+10:00')
})

it('rejects ambiguous identities, completed races and matches from another date', async () => {
  const meetings = [{ meetingName: 'EAGLE FARM', venueMnemonic: 'EAG', raceType: 'R', races: [
    tabRace(1), tabRace(1), tabRace(2, { raceStatus: 'Paying' }), tabRace(3), tabRace(4),
  ] }]
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => Response.json({
    meetings: String(url).includes('2026-09-26') ? meetings : [],
  }))
  expect(await getTabScheduledRaces([
    makeRace('duplicate-tab', 'Eagle Farm'), makeRace('completed', 'Eagle Farm', 2),
    makeRace('duplicate-internal-a', 'Eagle Farm', 3), makeRace('duplicate-internal-b', 'Eagle Farm', 3),
    makeRace('next-day', 'Eagle Farm', 4, '2026-09-27T05:00:00Z'),
  ], fetcher)).toEqual([])
})