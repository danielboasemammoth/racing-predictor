import { expect, it, vi } from 'vitest'
import { getTabRaceIds } from './tab-races'
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
    makeRace('wrong-time', 'Mornington', 1, '2026-09-26T07:00:00Z')]
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