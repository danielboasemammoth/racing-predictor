import { expect, it } from 'vitest'
import { partitionRecommendations } from './valid-recommendations'
import type { RunnerRecommendation } from './generate-recommendations'

it('rejects missing and non-finite probabilities without inventing replacements', () => {
  const rows = [null, NaN, Infinity, -0.1, 1.1, 0, 0.4, 1].map((modelProbability, runnerNumber) =>
    ({ runnerNumber, modelProbability, decision: 'NO_BET', place: null }) as RunnerRecommendation)
  const result = partitionRecommendations(rows)
  expect(result.valid).toEqual(rows.slice(5))
  expect(result.rejected).toHaveLength(5)
  expect(rows[0].modelProbability).toBeNull()
})

it('never permits an invalid PLACE recommendation to reach the betting loop', () => {
  const row = { runnerNumber: 1, modelProbability: 0.3, place: { modelProbability: NaN, decision: 'BET' } } as RunnerRecommendation
  expect(partitionRecommendations([row])).toEqual({ valid: [], rejected: [{ runnerNumber: 1, reason: 'Invalid PLACE probability' }] })
})