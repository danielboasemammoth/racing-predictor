/**
 * Decimal-odds probability/value math shared by every betting surface (horse + greyhound).
 * Deliberately independent of any particular prediction model or data source.
 */

export function impliedProbability(decimalOdds: number): number {
  if (decimalOdds <= 1) return 1
  return 1 / decimalOdds
}

/** Percentage-point edge: model probability minus the market's raw implied probability. */
export function probabilityEdgePoints(modelProbability: number, decimalOdds: number): number {
  return (modelProbability - impliedProbability(decimalOdds)) * 100
}

/** Expected value of a $1 stake at these decimal odds, given the model's true-probability estimate. */
export function expectedValue(modelProbability: number, decimalOdds: number): number {
  return modelProbability * decimalOdds - 1
}

/**
 * Sum of implied probabilities across an entire field's prices from ONE bookmaker/product.
 * A single book's market is always > 1 (100%); the excess is the bookmaker's overround/margin.
 */
export function fieldOverround(fieldDecimalOdds: number[]): number {
  return fieldDecimalOdds.reduce((sum, odds) => sum + impliedProbability(odds), 0)
}

/**
 * No-vig ("true") probability per runner: each runner's raw implied probability rescaled so the
 * field sums to 1. Never treat raw implied odds as true probabilities - always remove the margin
 * first when comparing against a model.
 */
export function noVigProbabilities(fieldDecimalOdds: number[]): number[] {
  const overround = fieldOverround(fieldDecimalOdds)
  if (overround <= 0) return fieldDecimalOdds.map(() => 0)
  return fieldDecimalOdds.map((odds) => impliedProbability(odds) / overround)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export interface BookmakerPricePoint {
  bookmakerKey: string
  price: number
}

export interface RunnerMarketConsensus {
  bestPrice: number
  bestBookmakerKey: string
  medianPrice: number
  averagePrice: number
  numBookmakers: number
  /** Std deviation of implied probabilities across books - higher means more market disagreement. */
  probabilityDispersion: number
}

/** Cross-bookmaker summary for a single runner. Does NOT include TAB-vs-consensus - see caller. */
export function runnerMarketConsensus(prices: BookmakerPricePoint[]): RunnerMarketConsensus | null {
  if (prices.length === 0) return null
  const best = prices.reduce((a, b) => (b.price > a.price ? b : a))
  const priceValues = prices.map((p) => p.price)
  const impliedProbs = priceValues.map(impliedProbability)
  return {
    bestPrice: best.price,
    bestBookmakerKey: best.bookmakerKey,
    medianPrice: median(priceValues),
    averagePrice: mean(priceValues),
    numBookmakers: prices.length,
    probabilityDispersion: stdDev(impliedProbs),
  }
}

/** How much better the best available price is than the TAB benchmark price, in decimal odds points. */
export function bestPriceVsTabDiff(bestPrice: number, tabPrice: number): number {
  return bestPrice - tabPrice
}

/** TAB's own implied probability minus the cross-book no-vig consensus probability, in percentage points. */
export function tabVsConsensusDiffPoints(tabPrice: number, consensusProbability: number): number {
  return (impliedProbability(tabPrice) - consensusProbability) * 100
}
