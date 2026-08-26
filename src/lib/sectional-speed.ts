/**
 * Sectional speed rating (spec Phase 4). Racing.com's own `standard_time_difference` field
 * already benchmarks a run's time against the historical standard for that track/distance/class
 * (verified empirically: winners average +1.0 lengths vs the standard, runs finishing 6th+
 * average -8.4 lengths), so this module doesn't need to build its own track/distance
 * normalization from scratch - it reuses that pre-normalized figure directly. Sign convention:
 * higher (less negative / more positive) = a faster, more meritorious run.
 */

/** Parses Racing.com's "-5.1L"/"+2.3L" style strings into a signed lengths value. */
export function parseStandardTimeDifference(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /(-?\d+(?:\.\d+)?)/.exec(value)
  if (!match) return null
  const lengths = Number.parseFloat(match[1])
  return Number.isFinite(lengths) ? lengths : null
}

export interface SectionalStart {
  standardTimeDifference: number | null
}

/**
 * Recency-weighted average benchmarked-time performance across a horse's past starts (most
 * recent first) - null when none of the starts have sectional data yet.
 */
export function averageSectionalRating(recentStartsFirst: SectionalStart[]): number | null {
  const values = recentStartsFirst
    .map((start, index) => (start.standardTimeDifference === null ? null : { value: start.standardTimeDifference, index }))
    .filter((entry): entry is { value: number; index: number } => entry !== null)
  if (!values.length) return null
  const weightTotal = values.reduce((sum, entry) => sum + Math.exp(-entry.index / 4), 0)
  return values.reduce((sum, entry) => sum + entry.value * Math.exp(-entry.index / 4), 0) / weightTotal
}
