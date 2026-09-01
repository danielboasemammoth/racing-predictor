/**
 * SIMULATION LABORATORY: recompute historical paper-bet performance under different rules
 * WITHOUT modifying the original bet records. Every recomputation replays the REAL recorded
 * outcome (WON/LOST/VOID/...) for each bet - it never invents a new result, only a different
 * stake size and/or a different subset of bets to include, so there is no look-ahead bias.
 */
import type { ConfidenceLevel } from '@/lib/betting/confidence'
import { recommendedStake, type StakingMethod } from '@/lib/betting/kelly'
import { computeWalletStats, settleBet, type BetResult, type WalletBetForStats, type WalletStats } from '@/lib/betting/paper-wallet'

export interface HistoricalBetRecord {
  placedAt: string
  decimalOdds: number
  modelProbability: number
  edgePoints: number | null
  confidenceLevel: ConfidenceLevel | null
  category: 'horse' | 'greyhound' | 'harness'
  /** The REAL, already-known outcome - never PENDING. What-if never changes what actually happened. */
  result: Exclude<BetResult, 'PENDING'>
  originalStake: number
}

export interface WhatIfRules {
  minConfidenceLevel?: ConfidenceLevel
  minEdgePoints?: number
  minOdds?: number
  maxOdds?: number
  categories?: Array<'horse' | 'greyhound' | 'harness'>
  /** If omitted, keeps each bet's originally recorded stake. */
  stakingMethod?: StakingMethod
}

const LEVEL_RANK: Record<ConfidenceLevel, number> = { VERY_LOW: 0, LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4 }

function passesFilters(bet: HistoricalBetRecord, rules: WhatIfRules): boolean {
  if (rules.minConfidenceLevel && (!bet.confidenceLevel || LEVEL_RANK[bet.confidenceLevel] < LEVEL_RANK[rules.minConfidenceLevel])) return false
  if (rules.minEdgePoints != null && (bet.edgePoints == null || bet.edgePoints < rules.minEdgePoints)) return false
  if (rules.minOdds != null && bet.decimalOdds < rules.minOdds) return false
  if (rules.maxOdds != null && bet.decimalOdds > rules.maxOdds) return false
  if (rules.categories && !rules.categories.includes(bet.category)) return false
  return true
}

/**
 * Bets must already be in chronological (placedAt ascending) order - stake recomputation under a
 * different staking method depends on the simulated bankroll at that point in the sequence.
 */
export function runWhatIf(startingBankroll: number, betsChronological: HistoricalBetRecord[], rules: WhatIfRules): WalletStats {
  const filtered = betsChronological.filter((bet) => passesFilters(bet, rules))

  let bankroll = startingBankroll
  const replayed: WalletBetForStats[] = []

  for (const bet of filtered) {
    const stake = rules.stakingMethod
      ? recommendedStake(rules.stakingMethod, bankroll, bet.decimalOdds, bet.modelProbability)
      : bet.originalStake
    if (stake <= 0) continue // wouldn't have qualified for a bet under the new staking method

    const { profit } = settleBet({ stake, decimalOdds: bet.decimalOdds }, bet.result)
    bankroll += profit
    replayed.push({ stake, decimalOdds: bet.decimalOdds, edgePoints: bet.edgePoints, result: bet.result, profit })
  }

  return computeWalletStats(startingBankroll, replayed)
}
