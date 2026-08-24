import { describe, expect, it } from 'vitest'
import { findSimilarRaces, type HistoricalRaceFeatures } from '@/lib/similar-races'

function race(overrides: Partial<HistoricalRaceFeatures> & { raceId: string }): HistoricalRaceFeatures {
  return {
    correctWinner: false,
    distanceM: 1200,
    raceType: 'maiden',
    fieldSize: 10,
    trackCondition: 'Good 4',
    barrierThird: 'inside',
    ...overrides,
  }
}

describe('findSimilarRaces', () => {
  it('uses the strictest tier when enough races match it', () => {
    const history = Array.from({ length: 35 }, (_, i) => race({ raceId: `r${i}`, correctWinner: i % 3 === 0 }))
    const result = findSimilarRaces(
      { distanceM: 1200, raceType: 'maiden', fieldSize: 10, trackCondition: 'Good 4', barrierThird: 'inside' },
      history,
    )
    expect(result.criteriaUsed).toEqual(['distance', 'race type', 'field size', 'barrier third', 'track condition'])
    expect(result.n).toBe(35)
  })

  it('relaxes criteria tier by tier until a credible sample size is reached', () => {
    const strictMatches = Array.from({ length: 5 }, (_, i) => race({ raceId: `strict${i}`, correctWinner: true }))
    const looserMatches = Array.from({ length: 40 }, (_, i) => race({ raceId: `loose${i}`, trackCondition: 'Heavy 9', correctWinner: false }))
    const history = [...strictMatches, ...looserMatches]

    const result = findSimilarRaces(
      { distanceM: 1200, raceType: 'maiden', fieldSize: 10, trackCondition: 'Good 4', barrierThird: 'inside' },
      history,
    )
    // Strict tier only has 5 matches (below the credible threshold), so it should relax to the
    // next tier (distance+type+field), which also includes the 40 "loose" races.
    expect(result.criteriaUsed).toEqual(['distance', 'race type', 'field size'])
    expect(result.n).toBe(45)
  })

  it('falls back to "all historical races" when nothing else has enough samples', () => {
    const history = [
      race({ raceId: 'a', raceType: 'group', correctWinner: true }),
      ...Array.from({ length: 40 }, (_, i) => race({ raceId: `other${i}`, raceType: 'benchmark' })),
    ]
    const result = findSimilarRaces(
      { distanceM: 1200, raceType: 'group', fieldSize: 10, trackCondition: 'Good 4', barrierThird: 'inside' },
      history,
    )
    expect(result.criteriaUsed).toEqual(['all historical races'])
    expect(result.n).toBe(41)
  })

  it('reports evidence confidence proportional to sample size', () => {
    const bigHistory = Array.from({ length: 100 }, (_, i) => race({ raceId: `r${i}`, correctWinner: i % 4 === 0 }))
    const result = findSimilarRaces(
      { distanceM: 1200, raceType: 'maiden', fieldSize: 10, trackCondition: 'Good 4', barrierThird: 'inside' },
      bigHistory,
    )
    expect(result.evidenceConfidence).toBe('High')
  })
})
