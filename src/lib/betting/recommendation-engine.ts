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
}

export const DEFAULT_THRESHOLDS: RecommendationThresholds = {
  minEdgePoints: 3,
  minConfidenceLevel: 'MODERATE',
  maxPriceAgeSeconds: 120,
  minFeatureCompleteness: 0.6,
  minMinutesToJump: 1,
  maxMinutesToJump: 240,
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
