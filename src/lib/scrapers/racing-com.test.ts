import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDistance, parseFinishingTime, parsePrice, parsePosition, parseWeight, selectMeetings, totalPrizeMoney, groupValidHorseIdsByRace, fetchMeetings } from '@/lib/scrapers/racing-com'

describe('Racing.com normalization', () => {
  it('normalizes race measurements', () => {
    expect(parseDistance('3250m')).toBe(3250)
    expect(parseWeight('69.5kg')).toBe(69.5)
    expect(parsePrice('$3.20')).toBe(3.2)
    expect(parseFinishingTime('1:03.98')).toBeCloseTo(63.98)
    expect(parseFinishingTime('7114')).toBeCloseTo(71.14)
    expect(parseFinishingTime(31197)).toBeCloseTo(311.97)
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
