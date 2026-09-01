import { describe, expect, it } from 'vitest'
import { harvilleTop3Probabilities } from '@/lib/betting/harville'

describe('harvilleTop3Probabilities', () => {
  it('returns an empty array for an empty field', () => {
    expect(harvilleTop3Probabilities([])).toEqual([])
  })

  it('gives every runner probability 1 when the whole field is 3 or fewer', () => {
    expect(harvilleTop3Probabilities([0.5, 0.3, 0.2])).toEqual([1, 1, 1])
    expect(harvilleTop3Probabilities([0.6, 0.4])).toEqual([1, 1])
  })

  it('sums place probabilities to 3 across the field (exactly 3 runners place each race)', () => {
    const uniform = harvilleTop3Probabilities([0.2, 0.2, 0.2, 0.2, 0.2])
    expect(uniform.reduce((s, v) => s + v, 0)).toBeCloseTo(3, 5)
  })

  it('sums to 3 for an uneven, realistic field of win probabilities', () => {
    const probs = [0.35, 0.25, 0.15, 0.1, 0.08, 0.04, 0.02, 0.01]
    const place = harvilleTop3Probabilities(probs)
    expect(place.reduce((s, v) => s + v, 0)).toBeCloseTo(3, 4)
  })

  it('gives equal place probability to equal win probabilities (symmetry)', () => {
    const place = harvilleTop3Probabilities([0.2, 0.2, 0.2, 0.2, 0.2])
    expect(new Set(place.map((v) => v.toFixed(6))).size).toBe(1)
  })

  it('is monotonic: a higher win probability always yields a higher place probability', () => {
    const place = harvilleTop3Probabilities([0.4, 0.3, 0.15, 0.1, 0.05])
    for (let i = 1; i < place.length; i++) {
      expect(place[i - 1]).toBeGreaterThanOrEqual(place[i])
    }
  })

  it('never exceeds probability 1 even for a heavy favourite', () => {
    const place = harvilleTop3Probabilities([0.9, 0.05, 0.02, 0.01, 0.01, 0.01])
    expect(place[0]).toBeLessThanOrEqual(1)
  })
})
