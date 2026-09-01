import { describe, expect, it } from 'vitest'
import { runWhatIf, type HistoricalBetRecord } from '@/lib/betting/what-if'

function bet(overrides: Partial<HistoricalBetRecord> = {}): HistoricalBetRecord {
  return {
    placedAt: '2026-01-01T00:00:00Z',
    decimalOdds: 4,
    modelProbability: 0.3,
    edgePoints: 5,
    confidenceLevel: 'HIGH',
    category: 'greyhound',
    result: 'WON',
    originalStake: 10,
    ...overrides,
  }
}

describe('runWhatIf', () => {
  it('replays original stakes and real outcomes when no staking method override is given', () => {
    const stats = runWhatIf(500, [bet({ result: 'WON', originalStake: 10 }), bet({ result: 'LOST', originalStake: 10 })], {})
    expect(stats.currentBankroll).toBe(500 + 30 - 10) // won: +30 (stake 10 @ odds 4), lost: -10
    expect(stats.numberSettled).toBe(2)
  })

  it('filters out bets below a minimum confidence level without touching the originals', () => {
    const bets = [bet({ confidenceLevel: 'LOW' }), bet({ confidenceLevel: 'VERY_HIGH' })]
    const stats = runWhatIf(500, bets, { minConfidenceLevel: 'HIGH' })
    expect(stats.numberSettled).toBe(1)
  })

  it('filters by minimum edge', () => {
    const bets = [bet({ edgePoints: 2 }), bet({ edgePoints: 8 })]
    const stats = runWhatIf(500, bets, { minEdgePoints: 5 })
    expect(stats.numberSettled).toBe(1)
  })

  it('filters by odds range', () => {
    const bets = [bet({ decimalOdds: 1.5 }), bet({ decimalOdds: 4 }), bet({ decimalOdds: 10 })]
    const stats = runWhatIf(500, bets, { minOdds: 2, maxOdds: 6 })
    expect(stats.numberSettled).toBe(1)
  })

  it('filters by category', () => {
    const bets = [bet({ category: 'horse' }), bet({ category: 'greyhound' })]
    const stats = runWhatIf(500, bets, { categories: ['greyhound'] })
    expect(stats.numberSettled).toBe(1)
  })

  it('recomputes stakes with a flat staking override, ignoring the originally recorded stake', () => {
    const bets = [bet({ originalStake: 999, result: 'WON', decimalOdds: 2 })]
    const stats = runWhatIf(1000, bets, { stakingMethod: 'flat-1pct' })
    // flat 1% of 1000 = 10, won at odds 2 -> profit 10
    expect(stats.netProfit).toBeCloseTo(10, 5)
  })

  it('recomputes stakes chronologically so bankroll compounds through a staking override', () => {
    const bets = [bet({ result: 'WON', decimalOdds: 2 }), bet({ result: 'WON', decimalOdds: 2 })]
    const stats = runWhatIf(1000, bets, { stakingMethod: 'flat-1pct' })
    // bet 1: stake 10 (1% of 1000), profit +10, bankroll -> 1010
    // bet 2: stake 10.10 (1% of 1010), profit +10.10
    expect(stats.numberSettled).toBe(2)
    expect(stats.netProfit).toBeCloseTo(20.1, 1)
  })

  it('skips a bet entirely when the recomputed Kelly stake is 0 (no edge under the new method)', () => {
    const bets = [bet({ decimalOdds: 1.5, modelProbability: 0.3, result: 'WON' })] // negative edge -> Kelly 0
    const stats = runWhatIf(1000, bets, { stakingMethod: 'kelly-0.25' })
    expect(stats.numberOfBets).toBe(0)
  })

  it('never changes the real recorded win/loss outcome regardless of staking overrides', () => {
    const bets = [bet({ result: 'LOST', originalStake: 5 })]
    const stats = runWhatIf(500, bets, { stakingMethod: 'flat-2pct' })
    expect(stats.netProfit).toBeLessThan(0)
  })

  it('returns an empty-history result when every bet is filtered out', () => {
    const stats = runWhatIf(500, [bet({ confidenceLevel: 'LOW' })], { minConfidenceLevel: 'VERY_HIGH' })
    expect(stats.numberOfBets).toBe(0)
    expect(stats.currentBankroll).toBe(500)
  })
})
