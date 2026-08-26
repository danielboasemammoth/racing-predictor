/**
 * Market-adjusted past performance (spec: "a finishing position should be interpreted relative
 * to market expectation... detect horses that consistently outperform/underperform market
 * expectations"). Deliberately separate from the model's own win_probability/Model Edge - this
 * is about a HORSE's history of beating or falling short of whatever price it started at,
 * independent of any particular model.
 */
import { marketImpliedProbability } from './reliability-analysis'

export interface MarketAdjustedStart {
  finishingPosition: number | null
  /** Decimal win odds recorded for this start - not a confirmed TAB/Betfair price, see roi-analysis.ts. */
  startingPrice: number | null
}

/** Positive = the horse won despite the market pricing it as unlikely; negative = market overrated it. */
export function marketResidual(start: MarketAdjustedStart): number | null {
  if (start.finishingPosition == null || !start.startingPrice) return null
  const won = start.finishingPosition === 1 ? 1 : 0
  return won - marketImpliedProbability(start.startingPrice)
}

/**
 * Recency-weighted average residual across a horse's past starts (most recent first) - positive
 * means the horse has a history of beating market pricing. Null when there's no priced history.
 */
export function averageMarketResidual(recentStartsFirst: MarketAdjustedStart[]): number | null {
  const residuals = recentStartsFirst.map(marketResidual).filter((value): value is number => value !== null)
  if (!residuals.length) return null
  const weightTotal = residuals.reduce((sum, _, index) => sum + Math.exp(-index / 4), 0)
  return residuals.reduce((sum, value, index) => sum + value * Math.exp(-index / 4), 0) / weightTotal
}
