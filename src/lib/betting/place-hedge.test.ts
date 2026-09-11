import { describe, expect, it } from 'vitest'
import { findPlaceHedgeOpportunities, jointPlaceProbability, type PlaceHedgeEntry } from '@/lib/betting/place-hedge'

describe('jointPlaceProbability', () => {
  it('returns 1 for an empty subset', () => {
    expect(jointPlaceProbability([0.5, 0.3, 0.2], [], 3)).toBe(1)
  })

  it('returns 0 when the subset is larger than the number of paid places', () => {
    expect(jointPlaceProbability([0.4, 0.3, 0.2, 0.1], [0, 1, 2], 2)).toBe(0)
  })

  it('returns 1 for any subset when the whole field is no bigger than the paid places', () => {
    expect(jointPlaceProbability([0.5, 0.3, 0.2], [0, 1], 3)).toBe(1)
  })

  it('matches the marginal harville place probability for a single-index subset', () => {
    const probs = [0.35, 0.25, 0.15, 0.1, 0.08, 0.04, 0.02, 0.01]
    expect(jointPlaceProbability(probs, [0], 3)).toBeCloseTo(0.8138, 3)
  })

  it('is symmetric and less than either individual place probability for a pair', () => {
    const probs = [0.3, 0.25, 0.2, 0.15, 0.06, 0.04]
    const both = jointPlaceProbability(probs, [0, 1], 3)
    const reordered = jointPlaceProbability(probs, [1, 0], 3)
    expect(both).toBeCloseTo(reordered, 10)
    expect(both).toBeLessThan(jointPlaceProbability(probs, [0], 3))
    expect(both).toBeLessThan(jointPlaceProbability(probs, [1], 3))
  })

  it('a specific ordered triple sums to the same as its 6 permutations for the exact-fill case', () => {
    const probs = [0.3, 0.25, 0.2, 0.15, 0.06, 0.04]
    const triple = jointPlaceProbability(probs, [0, 1, 2], 3)
    expect(triple).toBeGreaterThan(0)
    expect(triple).toBeLessThan(1)
  })
})

describe('findPlaceHedgeOpportunities', () => {
  function entry(horseId: string, winProbability: number, placeProbability: number, placeOdds?: number): PlaceHedgeEntry {
    return { horseId, horseName: `Horse ${horseId}`, winProbability, placeProbability, placeOdds }
  }

  it('returns nothing when fewer than 2 places are paid', () => {
    const field = [entry('a', 0.5, 0.5, 2), entry('b', 0.3, 0.3, 3)]
    expect(findPlaceHedgeOpportunities(field, 1)).toEqual([])
  })

  it('returns nothing when no combination has a positive combined edge', () => {
    // Odds deliberately priced under (worse than) the model's own probability for every runner,
    // so every possible combination must have a negative combined edge.
    const underPrice = (probability: number) => 0.9 / probability
    const field = [
      entry('a', 0.3, 0.75, underPrice(0.75)),
      entry('b', 0.25, 0.65, underPrice(0.65)),
      entry('c', 0.2, 0.55, underPrice(0.55)),
      entry('d', 0.15, 0.45, underPrice(0.45)),
      entry('e', 0.06, 0.25, underPrice(0.25)),
      entry('f', 0.04, 0.18, underPrice(0.18)),
    ]
    expect(findPlaceHedgeOpportunities(field, 3)).toEqual([])
  })

  it('finds a positive-edge two-runner hedge when place odds are generous vs modelled probability', () => {
    const field = [
      entry('a', 0.3, 0.75, 3), // implied 33% vs modelled 75% - big overlay
      entry('b', 0.25, 0.65, 3), // implied 33% vs modelled 65% - overlay
      entry('c', 0.2, 0.55, 1.2),
      entry('d', 0.15, 0.45, 1.3),
      entry('e', 0.06, 0.25, 4),
      entry('f', 0.04, 0.18, 5.5),
    ]
    const opportunities = findPlaceHedgeOpportunities(field, 3)
    expect(opportunities.length).toBeGreaterThan(0)
    const best = opportunities[0]
    expect(best.combinedEdge).toBeGreaterThan(0)
    expect(best.horses.length).toBeGreaterThanOrEqual(2)
    // Stake shares sum to 1 and the guaranteed payout if exactly one hits is identical for both.
    const totalShare = best.horses.reduce((sum, h) => sum + h.stakeShare, 0)
    expect(totalShare).toBeCloseTo(1, 6)
    const payouts = best.horses.map((h) => h.stakeShare * 10 * h.placeOdds)
    for (const payout of payouts) expect(payout).toBeCloseTo(payouts[0], 6)
  })

  it('probAtLeastOnePlaces is less than the naive sum of individual place probabilities', () => {
    const field = [
      entry('a', 0.3, 0.75, 3),
      entry('b', 0.25, 0.65, 3),
      entry('c', 0.2, 0.55, 1.2),
      entry('d', 0.15, 0.45, 1.3),
      entry('e', 0.06, 0.25, 4),
      entry('f', 0.04, 0.18, 5.5),
    ]
    const opportunities = findPlaceHedgeOpportunities(field, 3)
    const best = opportunities[0]
    const naiveSum = best.horses.reduce((sum, h) => sum + h.placeProbability, 0)
    expect(best.probAtLeastOnePlaces).toBeLessThan(naiveSum)
    expect(best.probAtLeastOnePlaces).toBeGreaterThan(0)
  })

  it('ignores candidates without place odds', () => {
    const field = [
      entry('a', 0.3, 0.75, 3),
      entry('b', 0.25, 0.65, undefined),
      entry('c', 0.2, 0.55, 1.2),
    ]
    const opportunities = findPlaceHedgeOpportunities(field, 3)
    for (const opportunity of opportunities) {
      expect(opportunity.horses.map((h) => h.horseId)).not.toContain('b')
    }
  })
})
