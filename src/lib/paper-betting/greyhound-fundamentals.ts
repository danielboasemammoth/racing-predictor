/**
 * MVP greyhound fundamentals model - built 2026-09-07 from PuntersEdge's greyhound form/stats
 * endpoints (real recent-run and box-performance data, verified live against the API). NOT yet
 * validated against real settled-bet outcomes (no greyhound paper bets have been placed off this
 * model yet) - the weights below are defensible starting points, not tuned, same honesty
 * convention as fundamentalsBlendWeight in generate-recommendations.ts.
 *
 * Deliberately does NOT attempt track-name matching: PuntersEdge's greyhound stats endpoint groups
 * by its own `track` strings (e.g. "Dport @ HOB"), which don't reliably match the `venue` strings
 * used elsewhere in this API (e.g. "LAUNCESTON") - rather than risk a wrong match, this model only
 * uses the `box` stats dimension, which is a plain integer and can never be ambiguous.
 */
import type { PeGreyhoundFormRun, PeGreyhoundStatsGroup } from '@/lib/puntersedge/types'

/** How much a run further back in history counts vs the most recent one (multiplicative per step). */
const RECENCY_DECAY = 0.8
/** Seconds-behind-winner penalty weight - keeps this from swamping the 1/position term (which ranges 0.125-1). */
const MARGIN_PENALTY_WEIGHT = 0.3
const MAX_RECENT_RUNS = 8
/** Weight given to the box-fit signal relative to the recent-form score when both are available. */
const BOX_FIT_WEIGHT = 0.5
/** A box's win_pct isn't trustworthy off a tiny sample - ignore groups below this many starts. */
const MIN_BOX_STARTS_FOR_SIGNAL = 3

/**
 * Recency-weighted average of (1/finishing position - margin-behind-winner penalty) over the most
 * recent non-scratched runs. Higher is better. Returns null when there's no usable run at all.
 */
export function computeRecentFormScore(runs: PeGreyhoundFormRun[]): number | null {
  const usable = runs.filter((run) => !run.scratched && run.position != null).slice(0, MAX_RECENT_RUNS)
  if (usable.length === 0) return null

  let weightedSum = 0
  let weightTotal = 0
  usable.forEach((run, index) => {
    const weight = RECENCY_DECAY ** index
    const positionQuality = 1 / (run.position as number)
    const marginPenalty = run.margin_s != null ? MARGIN_PENALTY_WEIGHT * run.margin_s : 0
    weightedSum += weight * (positionQuality - marginPenalty)
    weightTotal += weight
  })
  return weightedSum / weightTotal
}

/** win_pct (0-1) for the runner's assigned box in this race, from a box-grouped stats response - null if no credible-sized group exists for that box. */
export function computeBoxFitScore(boxStatsGroups: PeGreyhoundStatsGroup[], box: number): number | null {
  const group = boxStatsGroups.find((g) => g.box === box)
  if (!group || group.starts < MIN_BOX_STARTS_FOR_SIGNAL) return null
  return group.win_pct / 100
}

export interface GreyhoundDogInput {
  runnerNumber: number
  /** Null when form data isn't available for this dog (fetch failure, ambiguous name, etc.). */
  form: PeGreyhoundFormRun[] | null
  boxStatsGroups: PeGreyhoundStatsGroup[] | null
  /** This dog's box in the CURRENT race (PeRunner.barrier) - needed to look up the matching box-stats group. */
  currentBox: number | null
}

/**
 * Combines recent-form + box-fit into a single score per dog, then softmax across the WHOLE
 * field (dogs with no signal get a neutral score of 0, i.e. "average competitor") - only entries
 * for dogs that had SOME real signal are returned (the caller, generate-recommendations.ts's
 * blendWithFundamentals, treats a missing entry as "fall back to market-only for this runner",
 * same convention as the horse fundamentals bridge).
 *
 * BUG FIXED (2026-09-07, caught via a live smoke test before it could compound): softmax-ing only
 * over the dogs that HAD data made their probabilities sum to 1.0 regardless of field size - with
 * partial coverage (common early on, capped at 10 new-dog fetches/sync) a single populated dog out
 * of 8 runners was assigned ~100% win probability instead of a field-size-aware share, producing
 * wildly overconfident 20+ point "edges" that weren't real. Scoring the full field (with neutral
 * placeholders for missing dogs) fixes the scale while still only surfacing genuine data points.
 */
export function computeGreyhoundFundamentalsProbabilities(dogs: GreyhoundDogInput[], temperature = 1): Map<number, number> {
  const scores = dogs.map((dog) => {
    const formScore = dog.form ? computeRecentFormScore(dog.form) : null
    const boxScore = dog.boxStatsGroups && dog.currentBox != null ? computeBoxFitScore(dog.boxStatsGroups, dog.currentBox) : null
    return { hasData: formScore != null || boxScore != null, score: (formScore ?? 0) + (boxScore ?? 0) * BOX_FIT_WEIGHT }
  })
  if (!scores.some((s) => s.hasData)) return new Map()

  const calibrated = scores.map((s) => s.score / temperature)
  const max = Math.max(...calibrated)
  const strengths = calibrated.map((v) => Math.exp(v - max))
  const total = strengths.reduce((sum, v) => sum + v, 0)

  const result = new Map<number, number>()
  scores.forEach((s, index) => {
    if (s.hasData) result.set(dogs[index].runnerNumber, strengths[index] / total)
  })
  return result
}
