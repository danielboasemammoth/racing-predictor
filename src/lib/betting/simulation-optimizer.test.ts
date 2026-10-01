import { expect, it } from 'vitest'
import { findProfitSuggestion } from './simulation-optimizer'
import { DEFAULT_SIMULATION_SETTINGS } from './simulation-preferences'
import type { SimulationRace } from './historical-simulator'

function races(losingHoldout = false): SimulationRace[] {
  return Array.from({ length: 100 }, (_, index) => ({ id: String(index), start: new Date(Date.UTC(2026, 8, Math.floor(index / 10) + 1, 1, index % 10)).toISOString(), settledAt: null, venue: 'Test', state: 'VIC', number: index + 1, fieldSize: 8,
    selections: [{ id: 'runner', horse: 'Runner', model: 'test', rank: 1, predictedAt: '2026-08-01T00:00:00Z', winProbability: 0.6, top3Probability: 0.8, reliability: null, winOdds: 2, placeOdds: 1.5, winSource: 'racing_com', placeSource: 'racing_com', position: losingHoldout && index >= 70 ? 8 : 1, scratched: false, winIssue: null, placeIssue: null }] }))
}

it('requires sufficient chronological evidence and never manufactures a preset', async () => {
  expect((await findProfitSuggestion([], 'WIN', DEFAULT_SIMULATION_SETTINGS)).eligible).toBe(false)
  expect((await findProfitSuggestion(races(), 'WIN', DEFAULT_SIMULATION_SETTINGS, () => true)).eligible).toBe(false)
})

it('chooses on training only and rejects a losing untouched holdout', async () => {
  const positive = await findProfitSuggestion(races(), 'WIN', DEFAULT_SIMULATION_SETTINGS)
  const negative = await findProfitSuggestion(races(true), 'WIN', DEFAULT_SIMULATION_SETTINGS)
  expect(positive.eligible).toBe(true)
  expect(negative.filter).toEqual(positive.filter)
  expect(negative.trainProfit).toBe(positive.trainProfit)
  expect(negative.eligible).toBe(false)
  expect(negative.holdoutProfit).toBeLessThan(0)
})