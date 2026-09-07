/**
 * Bridges the PuntersEdge market-consensus baseline with this repo's existing Racing.com horse
 * fundamentals model (prediction-suite.ts). Wired into the live sync pipeline (2026-09-07, see
 * repository.ts's findHorseFundamentalsMatch) for horse-category races only - greyhound/harness
 * have no internal fundamentals model to bridge to.
 * Matching is necessarily heuristic (no stable ID is shared between PuntersEdge and the internal
 * `races` table): venue name + race number + start-time tolerance, via findMatchingInternalRace()
 * below - conservative by design, returns null (safe fallback to market-consensus-only) on zero OR
 * multiple candidate matches rather than ever guessing.
 */

import type { PredictedHorse } from '@/lib/types'

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
 * PuntersEdge horse names sometimes carry a trailing country-of-origin suffix for imported horses
 * (e.g. "Wrist Art (Ire)") that the internal Racing.com-sourced `horses` table never has (verified
 * live - zero internal horse names contain parentheses) - strip it before comparing.
 */
export function normalizeHorseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*\([a-z]{2,4}\)\s*$/i, '')
    .trim()
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

/**
 * Maps PuntersEdge runner numbers to the matched internal race's fundamentals win probability, by
 * normalized-name lookup (no shared ID exists between the two systems). Runners with no name match
 * (e.g. a very recent name correction) are simply absent from the returned map - the caller treats
 * a missing entry as "no fundamentals available", falling back to market-only for that runner.
 */
export function buildFundamentalsProbabilityMap(
  runners: Array<{ number: number; name: string }>,
  internalHorses: PredictedHorse[],
): Map<number, number> {
  const probabilityByName = new Map<string, number>()
  for (const horse of internalHorses) {
    if (horse.win_probability == null) continue
    probabilityByName.set(normalizeHorseName(horse.horse_name), horse.win_probability)
  }

  const result = new Map<number, number>()
  for (const runner of runners) {
    const probability = probabilityByName.get(normalizeHorseName(runner.name))
    if (probability != null) result.set(runner.number, probability)
  }
  return result
}
