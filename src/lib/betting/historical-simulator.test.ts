import { expect, it } from 'vitest'
import { DEFAULT_SIMULATION_FILTERS, matchesSimulationFilters, simulateBets, simulationCandidates, type SimulationRace, type SimulationSettings } from './historical-simulator'

const settings: SimulationSettings = { startingBankroll: 100, method: 'flat', flatStake: 10, stakePercent: 1 }
const filters = { WIN: { ...DEFAULT_SIMULATION_FILTERS }, PLACE: { ...DEFAULT_SIMULATION_FILTERS } }
const race: SimulationRace = { id: 'race', start: '2026-09-01T01:00:00Z', settledAt: '2026-09-01T01:10:00Z', venue: 'Test', state: 'VIC', number: 1, fieldSize: 8,
  selections: [{ id: 'horse', horse: 'Runner', model: 'model', rank: 1, predictedAt: '2026-09-01T00:00:00Z', winProbability: 0.4, top3Probability: 0.7, reliability: null, winOdds: 3, placeOdds: 2, winSource: 'tab', placeSource: 'tab', position: 2, scratched: false, winIssue: null, placeIssue: null }] }

it('creates both markets and applies strict default probability and edge thresholds', () => {
  const bets = simulationCandidates([race])
  expect(bets).toHaveLength(2)
  expect(matchesSimulationFilters(bets[0], filters.WIN)).toBe(true)
  expect(matchesSimulationFilters({ ...bets[0], edge: 0 }, filters.WIN)).toBe(false)
  expect(matchesSimulationFilters({ ...bets[0], selection: { ...bets[0].selection, top3Probability: 0.5 } }, filters.WIN)).toBe(false)
  expect(matchesSimulationFilters(bets[0], { ...filters.WIN, minReliability: 50 })).toBe(false)
})

it('calculates stake-weighted ROI from all filtered results without changing source data', () => {
  const candidates = simulationCandidates([race])
  const result = simulateBets(candidates, filters, settings)
  expect(result.summaries[0]).toMatchObject({ bets: 2, wins: 1, staked: 20, profit: 0, roi: 0, bankroll: 100, maxDrawdown: 0 })
  expect(candidates.every(bet => bet.stake === 0)).toBe(true)
  expect(simulateBets(candidates, { ...filters, WIN: { ...filters.WIN, enabled: false } }, settings).summaries[0]).toMatchObject({ staked: 10, profit: 10, roi: 100 })
})

it('excludes unsupported settlements and refunds scratches without inflating ROI turnover', () => {
  const source = { ...race, selections: [{ ...race.selections[0], scratched: true, placeIssue: 'Two-place market' }] }
  const result = simulateBets(simulationCandidates([source]), filters, settings)
  expect(result.summaries[0]).toMatchObject({ bets: 0, roi: null, refunded: 1, excluded: 1, bankroll: 100 })
})

it('never spends unsettled proceeds and apportions simultaneous bets within the bankroll', () => {
  const later = { ...race, id: 'later', start: '2026-09-01T01:05:00Z', settledAt: null }
  const result = simulateBets(simulationCandidates([race, later]), filters, { ...settings, startingBankroll: 10 })
  expect(result.bets.filter(bet => bet.race.id === 'race').map(bet => bet.stake)).toEqual([5, 5])
  expect(result.bets.filter(bet => bet.race.id === 'later').every(bet => bet.status === 'NO_BANKROLL')).toBe(true)
})

it('keeps model bankrolls independent and does not count a model duplicate as one stake', () => {
  const source = { ...race, selections: [...race.selections, { ...race.selections[0], model: 'other' }] }
  const result = simulateBets(simulationCandidates([source]), filters, settings)
  expect(result.summaries).toHaveLength(2)
  expect(result.summaries.every(summary => summary.staked === 20 && summary.bankroll === 100)).toBe(true)
})

it('applies percentage and Kelly staking and rejects invalid bankroll inputs', () => {
  const candidates = simulationCandidates([race])
  expect(simulateBets(candidates, filters, { ...settings, method: 'percent' }).summaries[0].staked).toBe(2)
  expect(simulateBets(candidates, filters, { ...settings, method: 'kelly-0.10' }).summaries[0].staked).toBeGreaterThan(0)
  expect(simulateBets(candidates, filters, { ...settings, startingBankroll: NaN }).summaries[0].staked).toBe(0)
})