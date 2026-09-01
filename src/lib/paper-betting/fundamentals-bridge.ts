/**
 * EXPERIMENTAL - NOT wired into the live sync pipeline (src/app/api/admin/puntersedge/sync).
 *
 * Bridges the PuntersEdge market-consensus baseline with this repo's existing Racing.com horse
 * fundamentals model (prediction-suite.ts), for a future hybrid model once match quality has been
 * verified against real overlapping data. Not enabled by default because:
 *   1. There is no stable ID shared between PuntersEdge and the internal `races` table - matching
 *      is necessarily heuristic (venue name + race number + start-time tolerance), and this repo's
 *      own memory explicitly warns that matching horse races by name/race_number is fragile.
 *   2. No live AU horse race has existed in both systems simultaneously during this session to
 *      validate real match accuracy - shipping this into auto-betting without that validation
 *      risks silently mismatching a horse and blending in the wrong fundamentals probability.
 * Use findMatchingInternalRace() to manually spot-check match quality before ever wiring
 * blendWithFundamentals() into generate-recommendations.ts.
 */

export interface InternalRaceCandidate {
  raceId: string
  racecourseName: string
  raceNumber: number
  /** ISO race_datetime from the internal `races` table. */
  raceDatetime: string
}

function normalizeVenueName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Conservative by design: returns null on zero OR multiple candidate matches rather than guessing
 * - a false negative (falls back to market-consensus-only) is safe, a false positive is not.
 */
export function findMatchingInternalRace(
  peVenue: string,
  peRaceNumber: number,
  peStartTimeIso: string,
  candidates: InternalRaceCandidate[],
  toleranceMinutes = 20,
): InternalRaceCandidate | null {
  const peVenueNormalized = normalizeVenueName(peVenue)
  const peStartTime = new Date(peStartTimeIso).getTime()

  const matches = candidates.filter((candidate) => {
    if (normalizeVenueName(candidate.racecourseName) !== peVenueNormalized) return false
    if (candidate.raceNumber !== peRaceNumber) return false
    const diffMinutes = Math.abs(new Date(candidate.raceDatetime).getTime() - peStartTime) / 60_000
    return diffMinutes <= toleranceMinutes
  })

  return matches.length === 1 ? matches[0] : null
}

/**
 * Blends per-runner fundamentals probabilities (null where a runner has no fundamentals match)
 * into the market-consensus probabilities, then renormalizes the whole field back to sum to 1 -
 * blending only some runners independently would otherwise break that invariant.
 */
export function blendWithFundamentals(
  marketProbabilities: number[],
  fundamentalsProbabilities: Array<number | null>,
  blendWeight = 0.5,
): number[] {
  const blended = marketProbabilities.map((marketProb, i) => {
    const fundamentalsProb = fundamentalsProbabilities[i]
    return fundamentalsProb == null ? marketProb : blendWeight * fundamentalsProb + (1 - blendWeight) * marketProb
  })
  const total = blended.reduce((sum, v) => sum + v, 0)
  return total > 0 ? blended.map((v) => v / total) : blended
}
