import { describe, expect, it } from 'vitest'
import { flatStakeReport } from '@/lib/roi-analysis'

describe('flatStakeReport', () => {
  it('computes profit, ROI, and win rate for a simple sequence', () => {
    const report = flatStakeReport([
      { won: true, odds: 4 }, // +3
      { won: false, odds: 3 }, // -1
      { won: false, odds: 5 }, // -1
    ])
    expect(report.bets).toBe(3)
    expect(report.totalStaked).toBe(3)
    expect(report.totalProfit).toBeCloseTo(1)
    expect(report.roi).toBeCloseTo(1 / 3)
    expect(report.winRate).toBeCloseTo(1 / 3)
  })

  it('reports average/median winning and losing prices separately', () => {
    const report = flatStakeReport([
      { won: true, odds: 4 },
      { won: true, odds: 6 },
      { won: false, odds: 2 },
    ])
    expect(report.averageWinningPrice).toBeCloseTo(5)
    expect(report.medianWinningPrice).toBeCloseTo(5)
    expect(report.averageLosingPrice).toBeCloseTo(2)
  })

  it('computes profit factor as gross profit over gross loss', () => {
    const report = flatStakeReport([
      { won: true, odds: 3 }, // +2
      { won: false, odds: 2 }, // -1
    ])
    expect(report.profitFactor).toBeCloseTo(2)
  })

  it('returns null profit factor when there are no losses', () => {
    const report = flatStakeReport([{ won: true, odds: 2 }])
    expect(report.profitFactor).toBeNull()
  })

  it('tracks max drawdown and longest losing streak in chronological order', () => {
    const report = flatStakeReport([
      { won: true, odds: 2 }, // cum 1, peak 1
      { won: false, odds: 2 }, // cum 0, dd 1
      { won: false, odds: 2 }, // cum -1, dd 2, streak 2
      { won: false, odds: 2 }, // cum -2, dd 3, streak 3
      { won: true, odds: 5 }, // cum 2, streak resets
    ])
    expect(report.maxDrawdown).toBeCloseTo(3)
    expect(report.longestLosingStreak).toBe(3)
  })

  it('handles an empty bet list without dividing by zero', () => {
    const report = flatStakeReport([])
    expect(report.bets).toBe(0)
    expect(report.roi).toBe(0)
    expect(report.profitFactor).toBeNull()
    expect(report.averageWinningPrice).toBeNull()
  })
})
