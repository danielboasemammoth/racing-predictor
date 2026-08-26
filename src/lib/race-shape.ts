/**
 * Race-shape/pace model (spec Phase 5). Classifies a runner's HABITUAL running style from its
 * history of in-running settled positions (Racing.com's positionAtSettled, already normalized to
 * a 0-1 percentile of that start's field size so it's comparable across different field sizes),
 * then aggregates a field's habitual styles into a pace-pressure read for an upcoming race - e.g.
 * a lone habitual leader gets an uncontested run, several leaders means a genuine speed battle.
 */

export type RunningStyle = 'leader' | 'on-pace' | 'midfield' | 'backmarker' | 'unknown'

export function runningPositionPercentile(position: number, fieldSize: number): number {
  if (fieldSize <= 1) return 0
  return (position - 1) / (fieldSize - 1)
}

export function classifyRunningStyle(positionPercentile: number): RunningStyle {
  if (positionPercentile <= 0.15) return 'leader'
  if (positionPercentile <= 0.4) return 'on-pace'
  if (positionPercentile <= 0.75) return 'midfield'
  return 'backmarker'
}

export interface RunningPositionStart {
  positionAtSettled: number | null
  fieldSize: number
}

/** The most common running-style classification across a horse's past starts; 'unknown' with no settled-position history (e.g. first starter). */
export function habitualRunningStyle(starts: RunningPositionStart[]): RunningStyle {
  const styles = starts
    .filter((start): start is RunningPositionStart & { positionAtSettled: number } => start.positionAtSettled !== null && start.fieldSize > 1)
    .map((start) => classifyRunningStyle(runningPositionPercentile(start.positionAtSettled, start.fieldSize)))
  if (!styles.length) return 'unknown'
  const counts = new Map<RunningStyle, number>()
  for (const style of styles) counts.set(style, (counts.get(style) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0]
}

export interface PaceShapeSummary {
  numLeaders: number
  numOnPace: number
  numMidfield: number
  numBackmarkers: number
  numUnknown: number
  /** 'uncontested' = at most one horse likely to lead/press the pace - favours that horse getting an easy run. */
  pacePressure: 'uncontested' | 'moderate' | 'hot'
}

export function summarizePaceShape(styles: RunningStyle[]): PaceShapeSummary {
  const numLeaders = styles.filter((style) => style === 'leader').length
  const numOnPace = styles.filter((style) => style === 'on-pace').length
  const numMidfield = styles.filter((style) => style === 'midfield').length
  const numBackmarkers = styles.filter((style) => style === 'backmarker').length
  const numUnknown = styles.filter((style) => style === 'unknown').length
  const pressureScore = numLeaders + numOnPace * 0.5
  const pacePressure = numLeaders <= 1 && numOnPace === 0 ? 'uncontested' : pressureScore >= 3 ? 'hot' : 'moderate'
  return { numLeaders, numOnPace, numMidfield, numBackmarkers, numUnknown, pacePressure }
}
