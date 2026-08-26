/**
 * Stewards-comment NLP (spec Phase 12). Deliberately simple keyword matching rather than a full
 * NLP/ML pipeline - Racing.com's stewards comments already use a fairly standardized incident
 * vocabulary, and the original comment text is always kept alongside the flags for traceability
 * (spec: "retain original text for traceability").
 */

export interface StewardsFlags {
  slowStart: boolean
  heldUp: boolean
  checkedOrInterference: boolean
  racedWide: boolean
  overraced: boolean
  laidInOrOut: boolean
}

const PATTERNS: Record<keyof StewardsFlags, RegExp> = {
  slowStart: /slow to begin|slow into stride|began awkwardly|missed the kick/i,
  heldUp: /held up|no clear run|restricted room|disappointed for a run/i,
  checkedOrInterference: /checked|hampered|bumped|crowded|tightened|steadied/i,
  racedWide: /raced wide|wide throughout|three-?wide|four-?wide/i,
  overraced: /raced keenly|over-?raced|raced ungenerously/i,
  laidInOrOut: /laid in|laid out/i,
}

export function extractStewardsFlags(comment: string | null | undefined): StewardsFlags {
  const text = comment ?? ''
  return {
    slowStart: PATTERNS.slowStart.test(text),
    heldUp: PATTERNS.heldUp.test(text),
    checkedOrInterference: PATTERNS.checkedOrInterference.test(text),
    racedWide: PATTERNS.racedWide.test(text),
    overraced: PATTERNS.overraced.test(text),
    laidInOrOut: PATTERNS.laidInOrOut.test(text),
  }
}

/** True if any "unlucky"/traffic-trouble flag is set - the flags most associated with the "forgive this run" theory. */
export function hadTroubledRun(flags: StewardsFlags): boolean {
  return flags.slowStart || flags.heldUp || flags.checkedOrInterference || flags.racedWide
}
