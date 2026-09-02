import { describe, it, expect } from 'vitest'
import { computeMarketCommission, computeNetProfitAfterCommission, approxNetProfitIfWins, commissionAdjustedExpectedValue } from './commission'

describe('computeMarketCommission', () => {
  it('charges nothing on a loss or breakeven market', () => {
    expect(computeMarketCommission(0, 0.1)).toBe(0)
    expect(computeMarketCommission(-50, 0.1)).toBe(0)
  })

  it('charges MBR on positive net market profit only', () => {
    expect(computeMarketCommission(100, 0.1)).toBeCloseTo(10, 6)
    expect(computeMarketCommission(100, 0.065)).toBeCloseTo(6.5, 6)
  })
})

describe('computeNetProfitAfterCommission', () => {
  it('subtracts commission from a winning market', () => {
    expect(computeNetProfitAfterCommission(100, 0.1)).toBeCloseTo(90, 6)
  })

  it('leaves a losing market unchanged (no commission on losses)', () => {
    expect(computeNetProfitAfterCommission(-40, 0.1)).toBe(-40)
  })
})

describe('approxNetProfitIfWins', () => {
  it('computes gross profit then applies commission', () => {
    // stake 10 @ 4.0 -> gross profit 30, commission 10% -> net 27
    expect(approxNetProfitIfWins(10, 4.0, 0.1)).toBeCloseTo(27, 6)
  })
})

describe('commissionAdjustedExpectedValue', () => {
  it('matches manual EV calc for a simple case', () => {
    const stake = 10
    const odds = 4.0
    const p = 0.3
    const mbr = 0.1
    const netWin = approxNetProfitIfWins(stake, odds, mbr)
    const expected = p * netWin - (1 - p) * stake
    expect(commissionAdjustedExpectedValue(stake, odds, p, mbr)).toBeCloseTo(expected, 6)
  })

  it('is lower than the commission-free EV (commission always reduces EV on a winning outcome)', () => {
    const withCommission = commissionAdjustedExpectedValue(10, 4.0, 0.4, 0.1)
    const withoutCommission = 0.4 * (10 * 3) - 0.6 * 10
    expect(withCommission).toBeLessThan(withoutCommission)
  })
})
