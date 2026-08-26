import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDistance, parseFinishingTime, parsePrice, parsePosition, parseWeight, parseMetres, parseRating, buildSpeedRatings, buildRunningPositions, selectMeetings, totalPrizeMoney, groupValidHorseIdsByRace, fetchMeetings, findMatchingRace, type RacingRace, type RacingEntry, type RacingEntryTimes } from '@/lib/scrapers/racing-com'

describe('Racing.com normalization', () => {
  it('normalizes race measurements', () => {
    expect(parseDistance('3250m')).toBe(3250)
    expect(parseWeight('69.5kg')).toBe(69.5)
    expect(parsePrice('$3.20')).toBe(3.2)
    expect(parseFinishingTime('1:03.98')).toBeCloseTo(63.98)
    expect(parseFinishingTime('7114')).toBeCloseTo(71.14)
    expect(parseFinishingTime(31197)).toBeCloseTo(311.97)
  })

  it('parses track geometry and rating strings', () => {
    expect(parseMetres('380m')).toBe(380)
    expect(parseMetres(null)).toBeNull()
    expect(parseRating('58.5')).toBe(58.5)
    expect(parseRating(-5.1)).toBe(-5.1)
    expect(parseRating(null)).toBeNull()
  })

  it('sums valid prize allocations and ignores malformed values', () => {
    expect(totalPrizeMoney([
      '{"Position":1,"Value":"21450.00"}',
      '{"Position":2,"Value":"6600.00"}',
      'invalid',
    ])).toBe(28050)
  })

  it('keeps every Victorian meeting unless an explicit cap is supplied', () => {
    const meetings = Array.from({ length: 15 }, (_, index) => ({
      id: String(index),
      venue: `Country Course ${index}`,
      date: '2026-08-16',
      state: 'VIC',
      isTrial: false,
      isJumpOut: false,
      meetUrl: `https://example.com/${index}`,
    }))
    expect(selectMeetings(meetings)).toHaveLength(15)
    expect(selectMeetings(meetings, 12)).toHaveLength(12)
  })

  it('parses API finishing positions, treating 109 as unplaced', () => {
    expect(parsePosition(1)).toBe(1)
    expect(parsePosition(8)).toBe(8)
    expect(parsePosition(16)).toBe(16)
    expect(parsePosition(109)).toBeNull()
    expect(parsePosition(100)).toBeNull()
    expect(parsePosition(null)).toBeNull()
  })

  it('groups the current fetch\'s horse ids per race so stale entries from earlier syncs can be identified', () => {
    const grouped = groupValidHorseIdsByRace([
      { race_id: 'race-1', horse_id: 'horse-a' },
      { race_id: 'race-1', horse_id: 'horse-b' },
      { race_id: 'race-2', horse_id: 'horse-c' },
    ])
    expect(grouped.get('race-1')).toEqual(['horse-a', 'horse-b'])
    expect(grouped.get('race-2')).toEqual(['horse-c'])
    expect(grouped.get('race-3')).toBeUndefined()
  })
})

describe('sectional/pace data structuring', () => {
  function fakeEntryTimes(overrides: Partial<RacingEntryTimes> = {}): RacingEntryTimes {
    return {
      horseCode: 'h1',
      horseName: 'Test Horse',
      avgSpeedEarly: 16.5,
      avgSpeedMid: 17.8,
      avgSpeedLate: 15.9,
      overallPeakSpeed: 18.2,
      overallAvgSpeed: 16.8,
      sixHundredMetresTime: '35.5',
      standardTimeDifference: '-5.1L',
      splitTimes: [{ avgSpeed: 18.2, distance: '800m-600m', index: 0, position: 3, time: '10.9' }],
      ...overrides,
    }
  }

  function fakeEntry(overrides: Partial<RacingEntry> = {}): RacingEntry {
    return {
      id: 'e1',
      position: 1,
      barrierNumber: 4,
      scratched: false,
      raceEntryNumber: 1,
      weight: '58kg',
      horseName: 'Test Horse',
      horseCountry: null,
      horseCode: 'h1',
      trainerName: 'T Trainer',
      jockeyName: 'J Jockey',
      margin: 0,
      winningTime: null,
      positionAt800: null,
      positionAt400: null,
      positionAtSettled: null,
      commentStewards: null,
      gearChanges: null,
      handicapRating: null,
      startingPrice: null,
      odds: [],
      horse: null,
      ...overrides,
    }
  }

  it('structures a runner\'s sectional splits/speed ratings, or null when Racing.com has none yet', () => {
    const ratings = buildSpeedRatings(fakeEntryTimes())
    expect(ratings).toMatchObject({
      avg_speed_early: 16.5,
      avg_speed_late: 15.9,
      standard_time_difference: '-5.1L',
      splits: [{ distance: '800m-600m', avg_speed: 18.2, position: 3, time: '10.9' }],
    })
    expect(buildSpeedRatings(undefined)).toBeNull()
  })

  it('structures a runner\'s in-running positions, or null until any are known', () => {
    expect(buildRunningPositions(fakeEntry({ positionAt800: 5, positionAt400: 3, positionAtSettled: 4 })))
      .toEqual({ at_800m: 5, at_400m: 3, at_settled: 4 })
    expect(buildRunningPositions(fakeEntry())).toBeNull()
  })
})

describe('findMatchingRace', () => {
  function fakeRace(id: string): RacingRace {
    return { id } as RacingRace
  }

  it('picks only the race whose external_id matches, ignoring every other race in the meeting', () => {
    const meetingRaces = [fakeRace('111'), fakeRace('222'), fakeRace('333')]
    const match = findMatchingRace(meetingRaces, 'racing-com:race:222')
    expect(match?.id).toBe('222')
  })

  it('returns undefined when no race in the meeting matches (e.g. race removed from the feed)', () => {
    const meetingRaces = [fakeRace('111'), fakeRace('222')]
    expect(findMatchingRace(meetingRaces, 'racing-com:race:999')).toBeUndefined()
  })
})

describe('fetchMeetings across states', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges meetings from every requested state and dedupes the VIC meetings every response repeats', async () => {
    const responsesByState: Record<string, Array<{ id: string; venue: string; state: string; isTrial: boolean; isJumpOut: boolean }>> = {
      VIC: [{ id: 'vic-1', venue: 'Flemington', state: 'VIC', isTrial: false, isJumpOut: false }],
      NSW: [
        { id: 'vic-1', venue: 'Flemington', state: 'VIC', isTrial: false, isJumpOut: false },
        { id: 'nsw-1', venue: 'Randwick', state: 'NSW', isTrial: false, isJumpOut: false },
        { id: 'nsw-trial', venue: 'Randwick', state: 'NSW', isTrial: true, isJumpOut: false },
      ],
    }
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { variables: { states: string } }
      return new Response(JSON.stringify({ data: { GetRaceMeetingsByStateNew: responsesByState[body.variables.states] ?? [] } }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const meetings = await fetchMeetings('2026-08-19', 0, 2, ['VIC', 'NSW'])

    expect(meetings.map((meeting) => meeting.id).sort()).toEqual(['nsw-1', 'vic-1'])
  })
})
