/**
 * Flat-stake profitability backtesting (spec sections 25-26). Uses whatever win odds were
 * actually recorded for a selection - see the caller for provenance labeling. This project only
 * has Racing.com's own embedded price feed today (no TAB/Betfair integration), so callers must
 * NOT present these figures as "TAB Fixed Win" or "Betfair SP" - label honestly as a displayed
 * price from the available feed.
 */

export interface FlatStakeBet {
  won: boolean
  /** Decimal win odds available for this selection at bet time. */
  odds: number
}

export interface FlatStakeReport {
  bets: number
  totalStaked: number
  totalProfit: number
  roi: number
  winRate: number
  averageWinningPrice: number | null
  medianWinningPrice: number | null
  averageLosingPrice: number | null
  /** Gross winnings / gross losses. Null when there are no losses to divide by. */
  profitFactor: number | null
  /** Largest peak-to-trough decline in cumulative profit, in stake units. */
  maxDrawdown: number
  longestLosingStreak: number
  /** Standard deviation of per-bet profit, in stake units. */
  volatility: number
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Bets must be supplied in chronological order - drawdown and losing-streak are order-dependent. */
export function flatStakeReport(bets: FlatStakeBet[], stake = 1): FlatStakeReport {
  const profits = bets.map((bet) => (bet.won ? stake * (bet.odds - 1) : -stake))
  const totalStaked = bets.length * stake
  const totalProfit = profits.reduce((sum, profit) => sum + profit, 0)
  const winningOdds = bets.filter((bet) => bet.won).map((bet) => bet.odds)
  const losingOdds = bets.filter((bet) => !bet.won).map((bet) => bet.odds)
  const grossProfit = profits.filter((profit) => profit > 0).reduce((sum, profit) => sum + profit, 0)
  const grossLoss = Math.abs(profits.filter((profit) => profit < 0).reduce((sum, profit) => sum + profit, 0))

  let cumulative = 0
  let peak = 0
  let maxDrawdown = 0
  let currentLosingStreak = 0
  let longestLosingStreak = 0
  for (const profit of profits) {
    cumulative += profit
    peak = Math.max(peak, cumulative)
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative)
    currentLosingStreak = profit < 0 ? currentLosingStreak + 1 : 0
    longestLosingStreak = Math.max(longestLosingStreak, currentLosingStreak)
  }

  const averageProfit = mean(profits) ?? 0
  const variance = profits.length ? profits.reduce((sum, profit) => sum + (profit - averageProfit) ** 2, 0) / profits.length : 0

  return {
    bets: bets.length,
    totalStaked,
    totalProfit,
    roi: totalStaked > 0 ? totalProfit / totalStaked : 0,
    winRate: bets.length ? winningOdds.length / bets.length : 0,
    averageWinningPrice: mean(winningOdds),
    medianWinningPrice: median(winningOdds),
    averageLosingPrice: mean(losingOdds),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdown,
    longestLosingStreak,
    volatility: Math.sqrt(variance),
  }
}
