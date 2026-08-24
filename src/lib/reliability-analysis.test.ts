import { describe, expect, it } from 'vitest'
import {
  agreementBand,
  barrierPercentile,
  barrierThird,
  bookmakerOverround,
  bucketize,
  classifyRaceType,
  distanceBand,
  fieldSizeBand,
  isAgeRestricted,
  isCountryBoosted,
  isSexRestricted,
  marketImpliedProbability,
  modelEdge,
  modelEdgeBand,
  normalizedMarketProbabilities,
  predictionGapBand,
  probabilityBand,
  shrinkRate,
  summarizeBucket,
  wilsonInterval,
} from '@/lib/reliability-analysis'

describe('wilsonInterval', () => {
  it('widens as sample size shrinks and narrows as it grows', () => {
    const small = wilsonInterval(3, 10)
    const large = wilsonInterval(300, 1000)
    expect(small[1] - small[0]).toBeGreaterThan(large[1] - large[0])
  })

  it('returns [0,0] for an empty sample', () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 0])
  })
})

describe('shrinkRate', () => {
  it('pulls small samples strongly toward the baseline', () => {
    // 3/6 = 50% raw, but with only 6 races and a 20% baseline it should land close to baseline
    const shrunk = shrinkRate(3, 6, 0.2)
    expect(shrunk).toBeLessThan(0.35)
    expect(shrunk).toBeGreaterThan(0.2)
  })

  it('barely moves large samples away from their raw rate', () => {
    const shrunk = shrinkRate(60, 200, 0.2)
    expect(shrunk).toBeCloseTo(60 / 200, 1)
  })
})

describe('summarizeBucket', () => {
  it('never calls a small sample significant even with a big raw deviation', () => {
    const stats = summarizeBucket('tiny', 3, 6, 0.2)
    expect(stats.significant).toBe(false)
  })

  it('can call a large, clearly-deviating sample significant', () => {
    const stats = summarizeBucket('big', 100, 200, 0.2)
    expect(stats.significant).toBe(true)
  })
})

describe('bucketize', () => {
  it('groups items and computes lift relative to the overall baseline', () => {
    const items = [
      { group: 'a', win: true }, { group: 'a', win: true }, { group: 'a', win: false },
      { group: 'b', win: false }, { group: 'b', win: false }, { group: 'b', win: false },
    ]
    const buckets = bucketize(items, (i) => i.group, (i) => i.win)
    const a = buckets.find((b) => b.label === 'a')!
    expect(a.wins).toBe(2)
    expect(a.n).toBe(3)
    expect(a.baseline).toBeCloseTo(2 / 6)
  })
})

describe('race classification', () => {
  it('classifies common Australian race_class strings', () => {
    expect(classifyRaceType('MDN-SW')).toBe('maiden')
    expect(classifyRaceType('3Y MDN-SW')).toBe('maiden')
    expect(classifyRaceType('BM70')).toBe('benchmark')
    expect(classifyRaceType('0 - 56')).toBe('benchmark')
    expect(classifyRaceType('CL2')).toBe('class')
    expect(classifyRaceType('HCP')).toBe('handicap')
    expect(classifyRaceType('Listed')).toBe('listed')
    expect(classifyRaceType('Group 3')).toBe('group')
    expect(classifyRaceType(null)).toBe('unknown')
  })

  it('detects country-boosted, sex-restricted, and age-restricted races', () => {
    expect(isCountryBoosted('CTRY BM58')).toBe(true)
    expect(isSexRestricted('F&M BM74')).toBe(true)
    expect(isAgeRestricted('3Y HCP')).toBe(true)
    expect(isAgeRestricted('BM70')).toBe(false)
  })
})

describe('distance/field/barrier bands', () => {
  it('bands distances per the spec thresholds', () => {
    expect(distanceBand(1000)).toBe('<=1000m')
    expect(distanceBand(1600)).toBe('1501-1600m')
    expect(distanceBand(2400)).toBe('>2000m')
    expect(distanceBand(null)).toBe('unknown')
  })

  it('bands field size', () => {
    expect(fieldSizeBand(6)).toBe('<=7')
    expect(fieldSizeBand(9)).toBe('8-10')
    expect(fieldSizeBand(16)).toBe('14+')
  })

  it('computes barrier percentile and third', () => {
    expect(barrierPercentile(1, 11)).toBe(0)
    expect(barrierPercentile(11, 11)).toBe(1)
    expect(barrierThird(1, 12)).toBe('inside')
    expect(barrierThird(6, 12)).toBe('middle')
    expect(barrierThird(12, 12)).toBe('outside')
  })
})

describe('probability, gap, and agreement bands', () => {
  it('bands win probability', () => {
    expect(probabilityBand(0.1)).toBe('<15%')
    expect(probabilityBand(0.32)).toBe('30-34.9%')
    expect(probabilityBand(0.5)).toBe('>=40%')
  })

  it('bands prediction gap', () => {
    expect(predictionGapBand(0.01)).toBe('<2pts')
    expect(predictionGapBand(0.2)).toBe('>=15pts')
  })

  it('bands model agreement as a percentage of active models', () => {
    expect(agreementBand(5, 5)).toBe('unanimous')
    expect(agreementBand(4, 5)).toBe('strong-majority')
    expect(agreementBand(1, 5)).toBe('minority')
  })
})

describe('market math', () => {
  it('converts decimal odds to implied probability', () => {
    expect(marketImpliedProbability(4)).toBeCloseTo(0.25)
    expect(marketImpliedProbability(2)).toBeCloseTo(0.5)
  })

  it('computes overround and normalizes it away', () => {
    const odds = [2, 3, 4]
    const overround = bookmakerOverround(odds)
    expect(overround).toBeGreaterThan(1)
    const normalized = normalizedMarketProbabilities(odds)
    expect(normalized.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('computes model edge and bands it', () => {
    expect(modelEdge(0.35, 0.2)).toBeCloseTo(0.15)
    expect(modelEdgeBand(0.15)).toBe('>=+15%')
    expect(modelEdgeBand(-0.2)).toBe('<-10%')
  })
})
