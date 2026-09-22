import type { RunnerRecommendation } from './generate-recommendations'

function validProbability(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

export function partitionRecommendations(recommendations: RunnerRecommendation[]) {
  const valid: RunnerRecommendation[] = []
  const rejected: Array<{ runnerNumber: number; reason: string }> = []
  for (const recommendation of recommendations) {
    if (!validProbability(recommendation.modelProbability)) {
      rejected.push({ runnerNumber: recommendation.runnerNumber, reason: 'Missing or invalid WIN probability' })
    } else if (recommendation.place && !validProbability(recommendation.place.modelProbability)) {
      rejected.push({ runnerNumber: recommendation.runnerNumber, reason: 'Invalid PLACE probability' })
    } else {
      valid.push(recommendation)
    }
  }
  return { valid, rejected }
}