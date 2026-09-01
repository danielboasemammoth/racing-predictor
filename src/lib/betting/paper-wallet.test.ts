import { describe, expect, it } from 'vitest'
import { computeWalletStats, settleBet, type WalletBetForStats } from '@/lib/betting/paper-wallet'

describe('settleBet', () => {
  it('pays stake x odds and profits the difference on a win', () => {
    expect(settleBet({ stake: 10, decimalOdds: 4.2 }, 'WON')).toEqual({ returnAmount: 42, profit: 32 })
  })

  it('returns nothing and loses the full stake on a loss', () => {
    expect(settleBet({ stake: 10, decimalOdds: 4.2 }, 'LOST')).toEqual({ returnAmount: 0, profit: -10 })
  })

  it('refunds the stake with no profit or loss for void/scratched/abandoned', () => {
    expect(settleBet({ stake: 10, decimalOdds: 4.2 }, 'VOID')).toEqual({ returnAmount: 10, profit: 0 })
    expect(settleBet({ stake: 10, decimalOdds: 4.2 }, 'SCRATCHED')).toEqual({ returnAmount: 10, profit: 0 })
    expect(settleBet({ stake: 10, decimalOdds: 4.2 }, 'ABANDONED')).toEqual({ returnAmount: 10, profit: 0 })
  })
})

function bet(overrides: Partial<WalletBetForStats>): WalletBetForStats {
  return { stake: 10, decimalOdds: 4, edgePoints: 5, result: 'PENDING', profit: null, ...overrides }
}

describe('computeWalletStats', () => {
  it('starts at the starting bankroll with no bets', () => {
    const stats = computeWalletStats(500, [])
    expect(stats.currentBankroll).toBe(500)
    expect(stats.netProfit).toBe(0)
    expect(stats.roiPct).toBe(0)
    expect(stats.winRate).toBeNull()
  })

  it('tracks bankroll growth across wins and losses', () => {
    const bets = [
      bet({ result: 'WON', profit: 30, decimalOdds: 4 }), // stake 10, win -> return 40
      bet({ result: 'LOST', profit: -10 }),
      bet({ result: 'WON', profit: 15, decimalOdds: 2.5 }),
    ]
    const stats = computeWalletStats(500, bets)
    expect(stats.currentBankroll).toBe(500 + 30 - 10 + 15)
    expect(stats.winRate).toBeCloseTo(2 / 3, 5)
    expect(stats.numberSettled).toBe(3)
    expect(stats.totalStaked).toBe(30)
  })

  it('excludes pending bets from win rate but counts their stake', () => {
    const stats = computeWalletStats(500, [bet({ result: 'PENDING' }), bet({ result: 'WON', profit: 30 })])
    expect(stats.numberPending).toBe(1)
    expect(stats.totalStaked).toBe(20)
    expect(stats.winRate).toBe(1)
  })

  it('does not count void/scratched bets as wins or losses, and refunds their stake', () => {
    const stats = computeWalletStats(500, [bet({ result: 'VOID', profit: 0 }), bet({ result: 'WON', profit: 30 })])
    expect(stats.winRate).toBe(1) // only 1 decided (won/lost) bet
    expect(stats.currentBankroll).toBe(530)
  })

  it('tracks longest winning and losing streaks, resetting on a void', () => {
    const bets = [
      bet({ result: 'WON', profit: 10 }),
      bet({ result: 'WON', profit: 10 }),
      bet({ result: 'LOST', profit: -10 }),
      bet({ result: 'VOID', profit: 0 }),
      bet({ result: 'LOST', profit: -10 }),
      bet({ result: 'LOST', profit: -10 }),
      bet({ result: 'LOST', profit: -10 }),
    ]
    const stats = computeWalletStats(500, bets)
    expect(stats.longestWinningStreak).toBe(2)
    expect(stats.longestLosingStreak).toBe(3)
  })

  it('computes max drawdown from the peak bankroll reached', () => {
    const bets = [
      bet({ result: 'WON', profit: 100 }), // bankroll 600, peak 600
      bet({ result: 'LOST', profit: -60 }), // bankroll 540, drawdown 10%
    ]
    const stats = computeWalletStats(500, bets)
    expect(stats.peakBankroll).toBe(600)
    expect(stats.maxDrawdownPct).toBeCloseTo(10, 5)
  })

  it('computes ROI against total staked, not starting bankroll', () => {
    const stats = computeWalletStats(500, [bet({ result: 'WON', profit: 30, stake: 10 })])
    expect(stats.roiPct).toBeCloseTo(300, 5) // +30 profit / 10 staked
  })
})
