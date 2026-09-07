import { expectedValue, probabilityEdgePoints } from '@/lib/betting/odds-math'
import type { ConfidenceLevel } from '@/lib/betting/confidence'

export type Decision = 'BET' | 'WATCH' | 'NO_BET'

export interface RecommendationInput {
  modelProbability: number
  tabPrice: number | null
  tabPriceAgeSeconds: number | null
  confidenceLevel: ConfidenceLevel
  minutesToJump: number
  isScratched: boolean
  raceStarted: boolean
  featureCompleteness: number
}

export interface RecommendationThresholds {
  minEdgePoints: number
  minConfidenceLevel: ConfidenceLevel
  maxPriceAgeSeconds: number
  minFeatureCompleteness: number
  minMinutesToJump: number
  maxMinutesToJump: number
  /** Reject candidates priced longer than this - see the 2026-09-07 comment below for why. */
  maxOdds: number
}

// Tuned 2026-09-05 via scripts/optimize-paper-betting-settings.ts against real yesterday+today AU
// racing results (see /memories/repo/racing-predictor-notes.md): an exhaustive backtest found NO
// threshold/staking config with positive net profit on that sample - WIN bets never qualified at
// any edge floor tested (no exploitable edge vs TAB's win price), and PLACE bets were consistently
// net-negative below roughly a 15pt edge floor.
// CORRECTED 2026-09-06: that 15pt floor was overfit to one atypical day - live monitoring the next
// day showed the best PLACE edge seen all day was only ~7pts, so it fired ZERO bets (confirmed via
// direct pe_recommendations query, not a bug). Edge magnitudes here vary a lot day to day; lowered
// to 5pts, a level that still filters obvious noise but reliably produces some real bet activity
// so the account can actually accumulate the real settled-bet history needed to validate/refute
// this model over the coming weeks - see that memory file before assuming this model is profitable.
// ADDED 2026-09-07: live data showed BET decisions firing at $41, $41, $41, $41, $34 and even $101
// off only 5-7pt edges - at those prices (implied win probability 1-2.5%) that edge claims the true
// probability is 3-4x the market's, which for a market-consensus-only model is almost always thin-
// liquidity/cross-bookmaker noise rather than genuine insight, not to mention the well-documented
// favorite-longshot bias (longshots are structurally overbet relative to true winning chances, so a
// model "finding value" on one is more likely wrong than right). `maxOdds` rejects candidates priced
// longer than this - a conservative starting heuristic (common professional practice avoids
// automated staking above ~$15-26 for the same reason), not yet tuned against real settled outcomes.
export const DEFAULT_THRESHOLDS: RecommendationThresholds = {
  minEdgePoints: 5,
  minConfidenceLevel: 'LOW',
  maxPriceAgeSeconds: 120,
  minFeatureCompleteness: 0.2,
  minMinutesToJump: 1,
  maxMinutesToJump: 180,
  maxOdds: 15,
}

export interface RecommendationResult {
  decision: Decision
  edgePoints: number | null
  expectedValueRatio: number | null
  reasons: string[]
  failedCriteria: string[]
}

const LEVEL_RANK: Record<ConfidenceLevel, number> = { VERY_LOW: 0, LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4 }

/**
 * BET requires every soft criterion to pass. WATCH is a promising opportunity (positive edge and
 * EV) that fails at least one criterion. Everything else, including every hard-fail condition,
 * is NO BET - the spec requires NO BET to be a normal, frequent outcome.
 */
export function recommend(input: RecommendationInput, thresholds: RecommendationThresholds = DEFAULT_THRESHOLDS): RecommendationResult {
  if (input.isScratched) {
    return { decision: 'NO_BET', edgePoints: null, expectedValueRatio: null, reasons: [], failedCriteria: ['runner is scratched'] }
  }
  if (input.raceStarted) {
    return { decision: 'NO_BET', edgePoints: null, expectedValueRatio: null, reasons: [], failedCriteria: ['race has already started'] }
  }
  if (input.tabPrice == null || input.tabPrice <= 1) {
    return { decision: 'NO_BET', edgePoints: null, expectedValueRatio: null, reasons: [], failedCriteria: ['no TAB price available'] }
  }

  const edgePoints = probabilityEdgePoints(input.modelProbability, input.tabPrice)
  const ev = expectedValue(input.modelProbability, input.tabPrice)

  const failedCriteria: string[] = []
  if (edgePoints < thresholds.minEdgePoints) failedCriteria.push(`edge ${edgePoints.toFixed(1)}pts below minimum ${thresholds.minEdgePoints}pts`)
  if (ev <= 0) failedCriteria.push(`EV ${(ev * 100).toFixed(1)}% is not positive`)
  if (LEVEL_RANK[input.confidenceLevel] < LEVEL_RANK[thresholds.minConfidenceLevel]) {
    failedCriteria.push(`confidence ${input.confidenceLevel} below minimum ${thresholds.minConfidenceLevel}`)
  }
  if (input.tabPriceAgeSeconds == null || input.tabPriceAgeSeconds > thresholds.maxPriceAgeSeconds) {
    failedCriteria.push('TAB price is not sufficiently fresh')
  }
  if (input.featureCompleteness < thresholds.minFeatureCompleteness) {
    failedCriteria.push(`feature completeness ${(input.featureCompleteness * 100).toFixed(0)}% below minimum`)
  }
  if (input.minutesToJump < thresholds.minMinutesToJump) failedCriteria.push('race starts too soon to safely act on')
  if (input.minutesToJump > thresholds.maxMinutesToJump) failedCriteria.push('race is too far away to price reliably')
  if (input.tabPrice > thresholds.maxOdds) failedCriteria.push(`odds $${input.tabPrice.toFixed(2)} exceed maximum $${thresholds.maxOdds.toFixed(2)} - too long to reliably price`)

  const reasons: string[] = [
    `Model probability ${(input.modelProbability * 100).toFixed(1)}% vs TAB implied probability`,
    `Edge: ${edgePoints >= 0 ? '+' : ''}${edgePoints.toFixed(1)} percentage points`,
    `EV: ${ev >= 0 ? '+' : ''}${(ev * 100).toFixed(1)}%`,
    `Confidence: ${input.confidenceLevel}`,
  ]

  if (failedCriteria.length === 0) {
    return { decision: 'BET', edgePoints, expectedValueRatio: ev, reasons, failedCriteria }
  }
  if (edgePoints > 0 && ev > 0) {
    return { decision: 'WATCH', edgePoints, expectedValueRatio: ev, reasons, failedCriteria }
  }
  return { decision: 'NO_BET', edgePoints, expectedValueRatio: ev, reasons, failedCriteria }
}
