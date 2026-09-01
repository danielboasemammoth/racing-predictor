import { describe, expect, it } from 'vitest'
import { DEFAULT_STAKING_CAPS, kellyFraction, recommendedStake } from '@/lib/betting/kelly'

describe('kelly staking', () => {
  it('computes the raw Kelly fraction for a positive-edge bet', () => {
    // odds 4.2, p=0.32 -> b=3.2, q=0.68, f=(3.2*0.32-0.68)/3.2 = (1.024-0.68)/3.2 = 0.1075
    expect(kellyFraction(4.2, 0.32)).toBeCloseTo(0.1075, 4)
  })

  it('returns 0 (never negative) when there is no edge', () => {
    expect(kellyFraction(2.0, 0.3)).toBe(0)
    expect(kellyFraction(1.0, 0.9)).toBe(0)
  })

  it('never recommends full Kelly - only fractional multipliers are exposed', () => {
    const bankroll = 1000
    const full = kellyFraction(4.2, 0.32) * bankroll
    const quarter = recommendedStake('kelly-0.25', bankroll, 4.2, 0.32, { maxStakePct: 1, minStake: 0, maxAbsoluteStake: 1_000_000 })
    expect(quarter).toBeLessThan(full)
    expect(quarter).toBeCloseTo(full * 0.25, 1)
  })

  it('caps stake at maxStakePct of bankroll', () => {
    const stake = recommendedStake('kelly-0.25', 1000, 10, 0.5, { maxStakePct: 0.05, minStake: 0, maxAbsoluteStake: 1_000_000 })
    expect(stake).toBeLessThanOrEqual(50)
  })

  it('caps stake at the absolute dollar maximum', () => {
    const stake = recommendedStake('kelly-0.25', 1_000_000, 10, 0.5, { maxStakePct: 1, minStake: 0, maxAbsoluteStake: 100 })
    expect(stake).toBeLessThanOrEqual(100)
  })

  it('returns 0 for a Kelly method when there is no edge (NO BET signal)', () => {
    expect(recommendedStake('kelly-0.10', 1000, 2.0, 0.3)).toBe(0)
  })

  it('returns 0 when the stake would fall below the minimum', () => {
    const stake = recommendedStake('flat-1pct', 10, 4.2, 0.32, { maxStakePct: 1, minStake: 5, maxAbsoluteStake: 1000 })
    expect(stake).toBe(0)
  })

  it('flat staking ignores model probability and odds entirely', () => {
    expect(recommendedStake('flat-1pct', 1000, 1.5, 0.9, DEFAULT_STAKING_CAPS)).toBeCloseTo(10, 5)
    expect(recommendedStake('flat-2pct', 1000, 50, 0.01, DEFAULT_STAKING_CAPS)).toBeCloseTo(20, 5)
  })

  it('returns 0 for a non-positive bankroll', () => {
    expect(recommendedStake('flat-1pct', 0, 4.2, 0.32)).toBe(0)
    expect(recommendedStake('kelly-0.25', -50, 4.2, 0.32)).toBe(0)
  })
})
