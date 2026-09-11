import { harvillePlaceProbabilities } from '@/lib/betting/harville'

/**
 * Multi-runner PLACE-market hedging ("dutching" across ≥2 selections, both/all of which can
 * genuinely pay simultaneously - unlike WIN dutching where exactly one selection can ever hit).
 * Everything here is derived from the same Plackett-Luce win-probability model
 * harvillePlaceProbabilities() already uses (see harville.ts) - never an independent/approximate
 * probability estimate.
 */

export interface PlaceHedgeEntry {
  horseId: string
  horseName: string
  /** Full-field win probability - required for every entry, used to compute joint place probabilities even for entries that aren't themselves part of a hedge. */
  winProbability: number
  placeProbability?: number
  placeOdds?: number
}

export interface PlaceHedgeOpportunity {
  horses: { horseId: string; horseName: string; placeOdds: number; placeProbability: number; stakeShare: number }[]
  /** Expected return per dollar staked, minus 1 - e.g. 0.15 means a 15% expected edge on the combined dutched stake. */
  combinedEdge: number
  /** Real (inclusion-exclusion, not naively summed) probability that at least one of these runners places. */
  probAtLeastOnePlaces: number
  /** Profit per $10 total stake if exactly one of the hedge's runners places (the dutched stake split guarantees this payout is the same regardless of which one hits). */
  guaranteedProfitPer10: number
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]]
  if (items.length < size) return []
  const [first, ...rest] = items
  const withFirst = combinations(rest, size - 1).map((combo) => [first, ...combo])
  const withoutFirst = combinations(rest, size)
  return [...withFirst, ...withoutFirst]
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const result: T[][] = []
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const perm of permutations(rest)) result.push([item, ...perm])
  })
  return result
}

function plSequenceProbability(winProbabilities: number[], order: number[]): number {
  let probability = 1
  let remaining = 1
  for (const index of order) {
    const p = winProbabilities[index]
    probability *= p / remaining
    remaining -= p
  }
  return probability
}

/**
 * Probability that every index in `subset` finishes within the first `paidPlaces` positions.
 * Supports subset sizes 1..paidPlaces (all this module ever needs); throws for anything larger
 * since that combination isn't used anywhere here.
 */
export function jointPlaceProbability(winProbabilities: number[], subset: number[], paidPlaces: 1 | 2 | 3): number {
  const n = winProbabilities.length
  if (subset.length === 0) return 1
  if (subset.length > paidPlaces) return 0
  if (n <= paidPlaces) return 1 // whole field places regardless of finishing order

  if (subset.length === 1) return harvillePlaceProbabilities(winProbabilities, paidPlaces)[subset[0]]

  if (subset.length === paidPlaces) {
    return permutations(subset).reduce((sum, order) => sum + plSequenceProbability(winProbabilities, order), 0)
  }

  if (subset.length === paidPlaces - 1) {
    let total = 0
    for (let k = 0; k < n; k++) {
      if (subset.includes(k)) continue
      total += permutations([...subset, k]).reduce((sum, order) => sum + plSequenceProbability(winProbabilities, order), 0)
    }
    return total
  }

  throw new Error(`jointPlaceProbability: unsupported subset size ${subset.length} for paidPlaces ${paidPlaces}`)
}

function nonEmptySubsets(indices: number[]): number[][] {
  const subsets: number[][] = []
  for (let mask = 1; mask < (1 << indices.length); mask++) {
    subsets.push(indices.filter((_, i) => mask & (1 << i)))
  }
  return subsets
}

/** Inclusion-exclusion over the joint place probabilities - the real chance at least one of these runners places, not a naive sum of their individual chances (which double-counts races where more than one of them places). */
function probabilityAtLeastOnePlaces(winProbabilities: number[], marginals: number[], indices: number[], paidPlaces: 1 | 2 | 3): number {
  let total = 0
  for (const subset of nonEmptySubsets(indices)) {
    const sign = subset.length % 2 === 1 ? 1 : -1
    const probability = subset.length === 1 ? marginals[subset[0]] : jointPlaceProbability(winProbabilities, subset, paidPlaces)
    total += sign * probability
  }
  return Math.min(1, Math.max(0, total))
}

/**
 * Finds positive-expected-value multi-runner PLACE dutches: stakes split proportional to
 * 1/placeOdds so that whichever ONE of the hedge's runners places, the payout is identical
 * regardless of which one it was (standard dutching maths - see the `stakeShare` math below).
 * Since PLACE markets pay out on multiple runners simultaneously (unlike WIN), the combined
 * expected value only needs each runner's own marginal place probability (linearity of
 * expectation - correlation doesn't matter for EV), while `probAtLeastOnePlaces` genuinely does
 * need the joint distribution, computed via `jointPlaceProbability` above.
 * Only returns hedges with a positive combined edge - never manufactures a suggestion just to
 * have content.
 */
export function findPlaceHedgeOpportunities(field: PlaceHedgeEntry[], paidPlaces: 1 | 2 | 3, maxCandidates = 6): PlaceHedgeOpportunity[] {
  if (paidPlaces < 2) return [] // fewer than 2 paid places means no two different runners can ever place simultaneously

  const winProbabilities = field.map((entry) => entry.winProbability)
  const marginals = harvillePlaceProbabilities(winProbabilities, paidPlaces)

  const candidates = field
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => (entry.placeOdds ?? 0) > 1 && (entry.placeProbability ?? 0) > 0)
    .sort((a, b) => (b.entry.placeProbability ?? 0) - (a.entry.placeProbability ?? 0))
    .slice(0, maxCandidates)

  const comboSizes = paidPlaces >= 3 ? [2, 3] : [2]
  const opportunities: PlaceHedgeOpportunity[] = []

  for (const size of comboSizes) {
    for (const combo of combinations(candidates, size)) {
      const inverseOddsSum = combo.reduce((sum, c) => sum + 1 / c.entry.placeOdds!, 0)
      const probabilitySum = combo.reduce((sum, c) => sum + (c.entry.placeProbability ?? 0), 0)
      const combinedEdge = probabilitySum / inverseOddsSum - 1
      if (combinedEdge <= 0) continue

      const indices = combo.map((c) => c.index)
      const commonPayoutPer10 = 10 / inverseOddsSum
      opportunities.push({
        horses: combo.map((c) => ({
          horseId: c.entry.horseId,
          horseName: c.entry.horseName,
          placeOdds: c.entry.placeOdds!,
          placeProbability: c.entry.placeProbability ?? 0,
          stakeShare: (1 / c.entry.placeOdds!) / inverseOddsSum,
        })),
        combinedEdge,
        probAtLeastOnePlaces: probabilityAtLeastOnePlaces(winProbabilities, marginals, indices, paidPlaces),
        guaranteedProfitPer10: commonPayoutPer10 - 10,
      })
    }
  }

  return opportunities.sort((a, b) => b.combinedEdge - a.combinedEdge).slice(0, 3)
}
