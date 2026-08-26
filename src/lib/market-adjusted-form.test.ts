import { describe, expect, it } from 'vitest'
import { marketResidual, averageMarketResidual } from '@/lib/market-adjusted-form'

describe('market-adjusted form', () => {
  it('is positive when a long-priced horse wins and negative when a short-priced horse loses', () => {
    expect(marketResidual({ finishingPosition: 1, startingPrice: 10 })).toBeCloseTo(1 - 0.1)
    expect(marketResidual({ finishingPosition: 2, startingPrice: 2 })).toBeCloseTo(0 - 0.5)
  })

  it('returns null without a finishing result or a recorded price', () => {
    expect(marketResidual({ finishingPosition: null, startingPrice: 5 })).toBeNull()
    expect(marketResidual({ finishingPosition: 1, startingPrice: null })).toBeNull()
  })

  it('weights recent starts more heavily and ignores unpriced starts', () => {
    const residual = averageMarketResidual([
      { finishingPosition: 1, startingPrice: 10 }, // most recent, big positive residual
      { finishingPosition: 5, startingPrice: null }, // unpriced, ignored
      { finishingPosition: 4, startingPrice: 2 }, // older, negative residual
    ])
    expect(residual).not.toBeNull()
    expect(residual!).toBeGreaterThan(0) // dominated by the more recent, larger positive residual
  })

  it('returns null when there is no priced history at all', () => {
    expect(averageMarketResidual([{ finishingPosition: 3, startingPrice: null }])).toBeNull()
    expect(averageMarketResidual([])).toBeNull()
  })
})
