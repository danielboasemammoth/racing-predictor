import { describe, it, expect } from 'vitest'
import { computeStake, computeConservativeStake, type StakingLimits } from './staking'

const limits: StakingLimits = { maxBet: 100, maxPctBankroll: 1 }

describe('computeStake - flat', () => {
  it('returns the flat amount within limits', () => {
    expect(computeStake({ method: 'flat', bankroll: 500, decimalOdds: 3, modelProbability: 0.4, flatStakeAmount: 5, pctBankrollStake: 0.01, limits })).toBe(5)
  })

  it('caps at maxBet', () => {
    expect(computeStake({ method: 'flat', bankroll: 500, decimalOdds: 3, modelProbability: 0.4, flatStakeAmount: 500, pctBankrollStake: 0.01, limits: { maxBet: 10, maxPctBankroll: 1 } })).toBe(10)
  })
})

describe('computeStake - pct-bankroll', () => {
  it('takes the configured percentage of bankroll', () => {
    expect(computeStake({ method: 'pct-bankroll', bankroll: 1000, decimalOdds: 3, modelProbability: 0.4, flatStakeAmount: 5, pctBankrollStake: 0.02, limits })).toBe(20)
  })
})

describe('computeStake - kelly variants', () => {
  it('returns 0 for negative-edge bets regardless of fraction', () => {
    // decimal odds 2.0, p=0.3 -> b=1, fraction = (1*0.3 - 0.7)/1 = -0.4 -> no edge
    expect(computeStake({ method: 'kelly-0.25', bankroll: 1000, decimalOdds: 2.0, modelProbability: 0.3, flatStakeAmount: 5, pctBankrollStake: 0.01, limits })).toBe(0)
  })

  it('scales stake with the chosen Kelly fraction multiplier', () => {
    const input = { bankroll: 1000, decimalOdds: 4.0, modelProbability: 0.4, flatStakeAmount: 5, pctBankrollStake: 0.01, limits }
    const tenth = computeStake({ ...input, method: 'kelly-0.10' as const })
    const quarter = computeStake({ ...input, method: 'kelly-0.25' as const })
    const half = computeStake({ ...input, method: 'kelly-0.50' as const })
    expect(tenth).toBeGreaterThan(0)
    expect(quarter).toBeCloseTo(tenth * 2.5, 2)
    expect(half).toBeCloseTo(tenth * 5, 2)
  })

  it('never exceeds maxPctBankroll even with a huge edge', () => {
    const result = computeStake({ method: 'kelly-0.50', bankroll: 1000, decimalOdds: 10, modelProbability: 0.5, flatStakeAmount: 5, pctBankrollStake: 0.01, limits: { maxBet: 10000, maxPctBankroll: 0.05 } })
    expect(result).toBeLessThanOrEqual(50)
  })
})

describe('computeConservativeStake', () => {
  it('returns 0 when there is no Kelly edge', () => {
    expect(computeConservativeStake(1000, 2.0, 0.3, 1, 0, 1000)).toBe(0)
  })

  it('discounts stake by confidence and uncertainty', () => {
    const fullConfidence = computeConservativeStake(1000, 4.0, 0.4, 1, 0, 1000)
    const halfConfidence = computeConservativeStake(1000, 4.0, 0.4, 0.5, 0, 1000)
    const withUncertainty = computeConservativeStake(1000, 4.0, 0.4, 1, 0.5, 1000)
    expect(halfConfidence).toBeCloseTo(fullConfidence * 0.5, 6)
    expect(withUncertainty).toBeCloseTo(fullConfidence * 0.5, 6)
  })

  it('caps at 20% of available liquidity', () => {
    const result = computeConservativeStake(100000, 4.0, 0.9, 1, 0, 10)
    expect(result).toBeLessThanOrEqual(2)
  })
})

describe('computeStake - conservative method wiring', () => {
  it('applies limits on top of the conservative formula', () => {
    const result = computeStake({
      method: 'conservative',
      bankroll: 100000,
      decimalOdds: 4.0,
      modelProbability: 0.9,
      flatStakeAmount: 5,
      pctBankrollStake: 0.01,
      limits: { maxBet: 1, maxPctBankroll: 1 },
      confidence: 1,
      modelUncertainty: 0,
      liquidityAvailable: 100000,
    })
    expect(result).toBe(1)
  })
})
