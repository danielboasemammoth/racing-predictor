import { describe, expect, it } from 'vitest'
import { harvillePlaceProbabilities } from '@/lib/betting/harville'

describe('harvillePlaceProbabilities', () => {
  it('returns an empty array for an empty field', () => {
    expect(harvillePlaceProbabilities([], 3)).toEqual([])
  })

  it('gives every runner probability 1 when the whole field is no bigger than the paid places', () => {
    expect(harvillePlaceProbabilities([0.5, 0.3, 0.2], 3)).toEqual([1, 1, 1])
    expect(harvillePlaceProbabilities([0.6, 0.4], 3)).toEqual([1, 1])
    expect(harvillePlaceProbabilities([0.6, 0.4], 2)).toEqual([1, 1])
  })

  it('sums place probabilities to 3 across the field when 3 places are paid', () => {
    const uniform = harvillePlaceProbabilities([0.2, 0.2, 0.2, 0.2, 0.2], 3)
    expect(uniform.reduce((s, v) => s + v, 0)).toBeCloseTo(3, 5)
  })

  it('sums to 3 for an uneven, realistic field of win probabilities', () => {
    const probs = [0.35, 0.25, 0.15, 0.1, 0.08, 0.04, 0.02, 0.01]
    const place = harvillePlaceProbabilities(probs, 3)
    expect(place.reduce((s, v) => s + v, 0)).toBeCloseTo(3, 4)
  })

  it('sums place probabilities to 2 across the field when only 2 places are paid (e.g. greyhound racing)', () => {
    const probs = [0.35, 0.25, 0.15, 0.1, 0.08, 0.04, 0.02, 0.01]
    const place = harvillePlaceProbabilities(probs, 2)
    expect(place.reduce((s, v) => s + v, 0)).toBeCloseTo(2, 4)
  })

  it('paidPlaces=1 is just the win probability unchanged', () => {
    const probs = [0.35, 0.25, 0.15, 0.1, 0.08, 0.04, 0.02, 0.01]
    expect(harvillePlaceProbabilities(probs, 1)).toEqual(probs)
  })

  it('gives equal place probability to equal win probabilities (symmetry)', () => {
    const place = harvillePlaceProbabilities([0.2, 0.2, 0.2, 0.2, 0.2], 3)
    expect(new Set(place.map((v) => v.toFixed(6))).size).toBe(1)
  })

  it('is monotonic: a higher win probability always yields a higher place probability', () => {
    const place = harvillePlaceProbabilities([0.4, 0.3, 0.15, 0.1, 0.05], 3)
    for (let i = 1; i < place.length; i++) {
      expect(place[i - 1]).toBeGreaterThanOrEqual(place[i])
    }
  })

  it('never exceeds probability 1 even for a heavy favourite', () => {
    const place = harvillePlaceProbabilities([0.9, 0.05, 0.02, 0.01, 0.01, 0.01], 3)
    expect(place[0]).toBeLessThanOrEqual(1)
  })
})
