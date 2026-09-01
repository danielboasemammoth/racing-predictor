import { describe, expect, it } from 'vitest'
import {
  bestPriceVsTabDiff,
  expectedValue,
  fieldOverround,
  impliedProbability,
  noVigProbabilities,
  probabilityEdgePoints,
  runnerMarketConsensus,
  tabVsConsensusDiffPoints,
} from '@/lib/betting/odds-math'

describe('odds-math', () => {
  it('computes implied probability from decimal odds', () => {
    expect(impliedProbability(4.2)).toBeCloseTo(0.238095, 5)
    expect(impliedProbability(2)).toBeCloseTo(0.5, 5)
  })

  it('matches the worked example from the product spec: $4.20, 32% model probability', () => {
    expect(probabilityEdgePoints(0.32, 4.2)).toBeCloseTo(8.19, 1)
    expect(expectedValue(0.32, 4.2)).toBeCloseTo(0.344, 3)
  })

  it('computes field overround above 1 for a single bookmaker (the house margin)', () => {
    // Three-runner field priced at $2, $4, $4 -> 0.5+0.25+0.25 = 1.0 (no margin, edge case)
    expect(fieldOverround([2, 4, 4])).toBeCloseTo(1.0, 5)
    // Realistic book with margin baked in
    expect(fieldOverround([1.9, 3.8, 3.8])).toBeGreaterThan(1)
  })

  it('normalises no-vig probabilities to sum to 1', () => {
    const noVig = noVigProbabilities([1.9, 3.8, 3.8])
    expect(noVig.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 5)
  })

  it('returns zeros rather than dividing by zero for a degenerate field', () => {
    expect(noVigProbabilities([])).toEqual([])
  })

  it('summarises cross-bookmaker consensus for a runner', () => {
    const consensus = runnerMarketConsensus([
      { bookmakerKey: 'tab', price: 4.2 },
      { bookmakerKey: 'sportsbet', price: 4.5 },
      { bookmakerKey: 'neds', price: 4.0 },
    ])
    expect(consensus).not.toBeNull()
    expect(consensus!.bestPrice).toBe(4.5)
    expect(consensus!.bestBookmakerKey).toBe('sportsbet')
    expect(consensus!.medianPrice).toBe(4.2)
    expect(consensus!.numBookmakers).toBe(3)
  })

  it('returns null consensus for an empty price list', () => {
    expect(runnerMarketConsensus([])).toBeNull()
  })

  it('computes best-price-vs-TAB and TAB-vs-consensus differences', () => {
    expect(bestPriceVsTabDiff(4.5, 4.2)).toBeCloseTo(0.3, 5)
    // TAB shorter (lower implied prob... wait TAB price lower means HIGHER implied prob) than consensus
    expect(tabVsConsensusDiffPoints(4.0, 0.2)).toBeGreaterThan(0)
  })
})
