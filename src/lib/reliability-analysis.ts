/**
 * Statistical building blocks for the reliability/market-intelligence analysis.
 * Pure functions only - no I/O - so they can run over any dataset (full history,
 * chronological train/validation/test slices, or a single upcoming race comparison).
 */

export interface BucketStats {
  label: string
  n: number
  wins: number
  strikeRate: number
  /** Wilson score interval bounds for the raw (unshrunk) strike rate. */
  ciLow: number
  ciHigh: number
  /** Empirical-Bayes strike rate, pulled toward the baseline for small samples. */
  shrunkStrikeRate: number
  baseline: number
  lift: number
  /** True once n clears MIN_CREDIBLE_SAMPLE and the CI excludes the baseline. */
  significant: boolean
}

/** Below this sample size, a bucket is not reported as an independent finding. */
export const MIN_CREDIBLE_SAMPLE = 30
/** Prior "pseudo-races" pulling small samples toward the baseline (empirical Bayes). */
const DEFAULT_PRIOR_STRENGTH = 20

/** 95% Wilson score interval for a binomial proportion - stable for small n unlike a normal approximation. */
export function wilsonInterval(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0]
  const p = wins / n
  const denominator = 1 + (z * z) / n
  const center = p + (z * z) / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (center - margin) / denominator), Math.min(1, (center + margin) / denominator)]
}

/** Shrinks a small-sample rate toward the baseline; large samples are barely affected. */
export function shrinkRate(wins: number, n: number, baseline: number, priorStrength = DEFAULT_PRIOR_STRENGTH): number {
  return (wins + priorStrength * baseline) / (n + priorStrength)
}

export function summarizeBucket(label: string, wins: number, n: number, baseline: number): BucketStats {
  const strikeRate = n > 0 ? wins / n : 0
  const [ciLow, ciHigh] = wilsonInterval(wins, n)
  const shrunkStrikeRate = shrinkRate(wins, n, baseline)
  return {
    label,
    n,
    wins,
    strikeRate,
    ciLow,
    ciHigh,
    shrunkStrikeRate,
    baseline,
    lift: shrunkStrikeRate - baseline,
    significant: n >= MIN_CREDIBLE_SAMPLE && (ciLow > baseline || ciHigh < baseline),
  }
}

/** Groups races into buckets and summarizes each against the overall baseline strike rate. */
export function bucketize<T>(
  items: T[],
  bucketOf: (item: T) => string,
  isWin: (item: T) => boolean,
): BucketStats[] {
  const baseline = items.length ? items.filter(isWin).length / items.length : 0
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const label = bucketOf(item)
    const group = groups.get(label) ?? []
    group.push(item)
    groups.set(label, group)
  }
  return [...groups.entries()]
    .map(([label, group]) => summarizeBucket(label, group.filter(isWin).length, group.length, baseline))
    .sort((left, right) => right.n - left.n)
}

export function distanceBand(distanceM: number | null | undefined): string {
  if (distanceM == null) return 'unknown'
  if (distanceM <= 1000) return '<=1000m'
  if (distanceM <= 1200) return '1001-1200m'
  if (distanceM <= 1400) return '1201-1400m'
  if (distanceM <= 1500) return '1401-1500m'
  if (distanceM <= 1600) return '1501-1600m'
  if (distanceM <= 1800) return '1601-1800m'
  if (distanceM <= 2000) return '1801-2000m'
  return '>2000m'
}

export function fieldSizeBand(fieldSize: number): string {
  if (fieldSize <= 7) return '<=7'
  if (fieldSize <= 10) return '8-10'
  if (fieldSize <= 13) return '11-13'
  return '14+'
}

export function barrierPercentile(barrier: number, fieldSize: number): number {
  if (fieldSize <= 1) return 0
  return (barrier - 1) / (fieldSize - 1)
}

export function barrierThird(barrier: number, fieldSize: number): 'inside' | 'middle' | 'outside' {
  const percentile = barrierPercentile(barrier, fieldSize)
  if (percentile <= 1 / 3) return 'inside'
  if (percentile <= 2 / 3) return 'middle'
  return 'outside'
}

export function probabilityBand(probability: number): string {
  if (probability < 0.15) return '<15%'
  if (probability < 0.2) return '15-19.9%'
  if (probability < 0.25) return '20-24.9%'
  if (probability < 0.3) return '25-29.9%'
  if (probability < 0.35) return '30-34.9%'
  if (probability < 0.4) return '35-39.9%'
  return '>=40%'
}

export function predictionGapBand(gap: number): string {
  if (gap < 0.02) return '<2pts'
  if (gap < 0.05) return '2-4.9pts'
  if (gap < 0.1) return '5-9.9pts'
  if (gap < 0.15) return '10-14.9pts'
  return '>=15pts'
}

export function agreementBand(agreeing: number, totalModels: number): string {
  if (totalModels <= 0) return 'unknown'
  const pct = agreeing / totalModels
  if (pct >= 0.999) return 'unanimous'
  if (pct >= 0.75) return 'strong-majority'
  if (pct >= 0.5) return 'majority'
  return 'minority'
}

export function modelEdgeBand(edge: number): string {
  if (edge < -0.1) return '<-10%'
  if (edge < -0.05) return '-10% to -5%'
  if (edge < 0) return '-5% to 0%'
  if (edge < 0.05) return '0% to +5%'
  if (edge < 0.1) return '+5% to +10%'
  if (edge < 0.15) return '+10% to +15%'
  return '>=+15%'
}

/** Classifies a raw race_class string (e.g. "BM70", "MDN-SW", "3Y HCP", "Group 3") into a coarse race type. */
export function classifyRaceType(raceClass: string | null | undefined): string {
  const value = (raceClass ?? '').toUpperCase()
  if (!value) return 'unknown'
  if (/\bSUPER\s*MDN|\bSUP\s*MDN/.test(value)) return 'super-maiden'
  if (/\bMDN\b/.test(value)) return 'maiden'
  if (/\bGROUP\s*\d|\bG[123]\b/.test(value)) return 'group'
  if (/\bLISTED\b/.test(value)) return 'listed'
  if (/\bBM\s*\d+|^\d+\s*-\s*\d+$|\bRTG\s*\d+/.test(value)) return 'benchmark'
  if (/\bCL\s*\d/.test(value)) return 'class'
  if (/\bHCP\b/.test(value)) return 'handicap'
  return 'other'
}

export function isCountryBoosted(raceClass: string | null | undefined): boolean {
  return /\bCTRY\b/.test((raceClass ?? '').toUpperCase())
}

export function isSexRestricted(raceClass: string | null | undefined): boolean {
  return /\bF&M\b|\bFILLIES\b|\bMARES\b|\bCOLTS\b|\bENTIRE/.test((raceClass ?? '').toUpperCase())
}

export function isAgeRestricted(raceClass: string | null | undefined): boolean {
  return /\b[234]\s*Y\b|\b[234]YO\b/.test((raceClass ?? '').toUpperCase())
}

/** Implied win probability from a decimal price, e.g. $5.00 -> 0.20. */
export function marketImpliedProbability(decimalOdds: number): number {
  return decimalOdds > 0 ? 1 / decimalOdds : 0
}

/** Bookmaker overround for a full market (sum of implied probabilities, >1 means the market has a margin). */
export function bookmakerOverround(decimalOdds: number[]): number {
  return decimalOdds.reduce((sum, odds) => sum + marketImpliedProbability(odds), 0)
}

/** Removes the bookmaker margin so implied probabilities sum to 1. */
export function normalizedMarketProbabilities(decimalOdds: number[]): number[] {
  const overround = bookmakerOverround(decimalOdds)
  if (overround <= 0) return decimalOdds.map(() => 0)
  return decimalOdds.map((odds) => marketImpliedProbability(odds) / overround)
}

/** Model Edge = model win probability - market implied probability, e.g. +0.15 = "+15 percentage points". */
export function modelEdge(modelProbability: number, marketProbability: number): number {
  return modelProbability - marketProbability
}
