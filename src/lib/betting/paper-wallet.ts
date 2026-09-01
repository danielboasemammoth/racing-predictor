/**
 * Pure bankroll/settlement math for the paper-betting simulation. No look-ahead: every function
 * here only ever uses information that was recorded at bet-placement time plus the final result.
 */

export type BetResult = 'PENDING' | 'WON' | 'LOST' | 'VOID' | 'SCRATCHED' | 'ABANDONED'

export interface SettledPaperBet {
  placedAt: string
  stake: number
  /** TAB decimal odds recorded AT PLACEMENT TIME - must never be replaced by a later price. */
  decimalOdds: number
  modelProbability: number
  result: BetResult
  /** Populated once settled; null while PENDING. */
  returnAmount: number | null
  profit: number | null
}

/**
 * Settle a bet given its final race result. VOID/SCRATCHED/ABANDONED refund the stake (no
 * profit, no loss) rather than inventing a payout. Never call this twice for the same bet -
 * callers are responsible for the idempotency guarantee (e.g. a DB status check).
 */
export function settleBet(
  bet: Pick<SettledPaperBet, 'stake' | 'decimalOdds'>,
  result: Exclude<BetResult, 'PENDING'>,
): { returnAmount: number; profit: number } {
  if (result === 'WON') {
    const returnAmount = bet.stake * bet.decimalOdds
    return { returnAmount, profit: returnAmount - bet.stake }
  }
  if (result === 'LOST') {
    return { returnAmount: 0, profit: -bet.stake }
  }
  // VOID / SCRATCHED / ABANDONED - stake refunded, no invented payout.
  return { returnAmount: bet.stake, profit: 0 }
}

export interface WalletStats {
  startingBankroll: number
  currentBankroll: number
  totalStaked: number
  totalReturned: number
  netProfit: number
  roiPct: number
  peakBankroll: number
  lowestBankroll: number
  maxDrawdownPct: number
  currentDrawdownPct: number
  longestWinningStreak: number
  longestLosingStreak: number
  winRate: number | null
  numberOfBets: number
  numberSettled: number
  numberPending: number
  averageOdds: number | null
  averageEdgePoints: number | null
  equityCurve: Array<{ afterBetIndex: number; bankroll: number }>
}

export interface WalletBetForStats {
  stake: number
  decimalOdds: number
  edgePoints: number | null
  result: BetResult
  profit: number | null
}

/**
 * Replays bets in chronological order (caller must pass them pre-sorted by placedAt) to build
 * the bankroll equity curve and derived stats. Pending bets count toward totalStaked but are
 * excluded from win-rate/streak/profit calculations until settled.
 */
export function computeWalletStats(startingBankroll: number, betsChronological: WalletBetForStats[]): WalletStats {
  let bankroll = startingBankroll
  let peak = startingBankroll
  let trough = startingBankroll
  let maxDrawdownPct = 0
  let totalStaked = 0
  let totalReturned = 0
  let currentStreak = 0
  let currentStreakType: 'W' | 'L' | null = null
  let longestWinningStreak = 0
  let longestLosingStreak = 0
  let wins = 0
  let settledCount = 0
  let pendingCount = 0
  const oddsSum: number[] = []
  const edgeSum: number[] = []
  const equityCurve: Array<{ afterBetIndex: number; bankroll: number }> = []

  betsChronological.forEach((bet, index) => {
    totalStaked += bet.stake
    if (bet.result === 'PENDING') {
      pendingCount += 1
      return
    }
    settledCount += 1
    oddsSum.push(bet.decimalOdds)
    if (bet.edgePoints != null) edgeSum.push(bet.edgePoints)

    const profit = bet.profit ?? 0
    bankroll += profit
    totalReturned += Math.max(0, profit + bet.stake) // returnAmount = profit+stake for won/void, 0 for lost
    peak = Math.max(peak, bankroll)
    trough = Math.min(trough, bankroll)
    const drawdownPct = peak > 0 ? ((peak - bankroll) / peak) * 100 : 0
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct)

    if (bet.result === 'WON') {
      wins += 1
      if (currentStreakType === 'W') currentStreak += 1
      else {
        currentStreak = 1
        currentStreakType = 'W'
      }
      longestWinningStreak = Math.max(longestWinningStreak, currentStreak)
    } else if (bet.result === 'LOST') {
      if (currentStreakType === 'L') currentStreak += 1
      else {
        currentStreak = 1
        currentStreakType = 'L'
      }
      longestLosingStreak = Math.max(longestLosingStreak, currentStreak)
    } else {
      // VOID/SCRATCHED/ABANDONED breaks a streak without counting as a win or loss.
      currentStreak = 0
      currentStreakType = null
    }

    equityCurve.push({ afterBetIndex: index, bankroll })
  })

  const currentDrawdownPct = peak > 0 ? ((peak - bankroll) / peak) * 100 : 0
  const decidedBets = betsChronological.filter((b) => b.result === 'WON' || b.result === 'LOST')

  return {
    startingBankroll,
    currentBankroll: bankroll,
    totalStaked,
    totalReturned,
    netProfit: bankroll - startingBankroll,
    roiPct: totalStaked > 0 ? ((bankroll - startingBankroll) / totalStaked) * 100 : 0,
    peakBankroll: peak,
    lowestBankroll: trough,
    maxDrawdownPct,
    currentDrawdownPct,
    longestWinningStreak,
    longestLosingStreak,
    winRate: decidedBets.length > 0 ? wins / decidedBets.length : null,
    numberOfBets: betsChronological.length,
    numberSettled: settledCount,
    numberPending: pendingCount,
    averageOdds: oddsSum.length > 0 ? oddsSum.reduce((s, v) => s + v, 0) / oddsSum.length : null,
    averageEdgePoints: edgeSum.length > 0 ? edgeSum.reduce((s, v) => s + v, 0) / edgeSum.length : null,
    equityCurve,
  }
}
