import { describe, expect, it } from 'vitest'
import { compareBaselines } from '@/lib/baseline-comparison'

describe('baseline comparison', () => {
  it('reports separate flat-stake results for the favourite and the model pick', () => {
    const result = compareBaselines([
      { favouritePrice: 2, favouriteWon: true, modelPickPrice: 5, modelPickWon: false },
      { favouritePrice: 3, favouriteWon: false, modelPickPrice: 4, modelPickWon: true },
      { favouritePrice: 2.5, favouriteWon: false, modelPickPrice: 6, modelPickWon: false },
    ])
    expect(result.favourite.bets).toBe(3)
    expect(result.model.bets).toBe(3)
    // Favourite: won at 2.0 (+1), lost at 3.0 (-1), lost at 2.5 (-1) => -1 total
    expect(result.favourite.totalProfit).toBeCloseTo(-1)
    // Model: lost at 5.0 (-1), won at 4.0 (+3), lost at 6.0 (-1) => +1 total
    expect(result.model.totalProfit).toBeCloseTo(1)
  })

  it('ignores races with no recorded price for that selection', () => {
    const result = compareBaselines([
      { favouritePrice: null, favouriteWon: false, modelPickPrice: null, modelPickWon: false },
    ])
    expect(result.favourite.bets).toBe(0)
    expect(result.model.bets).toBe(0)
  })
})
