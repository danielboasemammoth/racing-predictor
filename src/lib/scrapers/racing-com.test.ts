import { describe, expect, it } from 'vitest'
import { parseDistance, parseFinishingTime, parsePrice, parseWeight, totalPrizeMoney } from '@/lib/scrapers/racing-com'

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
})