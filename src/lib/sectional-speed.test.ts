import { describe, expect, it } from 'vitest'
import { parseStandardTimeDifference, averageSectionalRating } from '@/lib/sectional-speed'

describe('sectional speed rating', () => {
  it('parses signed lengths-vs-standard strings', () => {
    expect(parseStandardTimeDifference('-5.1L')).toBeCloseTo(-5.1)
    expect(parseStandardTimeDifference('+2.3L')).toBeCloseTo(2.3)
    expect(parseStandardTimeDifference('0L')).toBe(0)
    expect(parseStandardTimeDifference(null)).toBeNull()
    expect(parseStandardTimeDifference(undefined)).toBeNull()
  })

  it('recency-weights a horse\'s past benchmarked performances, ignoring starts with no sectional data', () => {
    const rating = averageSectionalRating([
      { standardTimeDifference: 2 }, // most recent, strong run
      { standardTimeDifference: null }, // no sectional data, ignored
      { standardTimeDifference: -8 }, // older, weak run
    ])
    expect(rating).not.toBeNull()
    expect(rating!).toBeGreaterThan(-3) // dominated by the more recent, stronger run
  })

  it('returns null with no sectional history at all', () => {
    expect(averageSectionalRating([{ standardTimeDifference: null }])).toBeNull()
    expect(averageSectionalRating([])).toBeNull()
  })
})
