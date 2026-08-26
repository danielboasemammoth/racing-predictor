/**
 * Form trajectory (spec: "do not treat form as a static average - estimate whether each horse is
 * improving/stable/declining"). Deliberately separate from prediction-v3.ts's `recentForm`
 * feature, which is a recency-weighted AVERAGE with no notion of direction - two horses can have
 * the same average while one is improving and the other declining.
 */

export interface FormPoint {
  /** 0-1 result quality for one start, e.g. prediction-v3.ts's resultScore(). */
  resultScore: number
}

/**
 * Recency-weighted linear trend (OLS slope of result score over start index, oldest to newest) -
 * positive means improving, negative means declining. Null with fewer than 3 starts, since a
 * trend line through 1-2 points isn't meaningful.
 */
export function formTrend(pointsRecentFirst: FormPoint[]): number | null {
  if (pointsRecentFirst.length < 3) return null
  const chronological = [...pointsRecentFirst].reverse()
  const n = chronological.length
  const xMean = (n - 1) / 2
  const yMean = chronological.reduce((sum, point) => sum + point.resultScore, 0) / n
  let numerator = 0
  let denominator = 0
  chronological.forEach((point, index) => {
    numerator += (index - xMean) * (point.resultScore - yMean)
    denominator += (index - xMean) ** 2
  })
  return denominator === 0 ? 0 : numerator / denominator
}
