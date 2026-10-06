import { expect, it } from 'vitest'
import { DEFAULT_SIMULATION_FILTERS, matchesSimulationFilters, simulateBets, simulationCandidates, simulationExclusionReasons, type SimulationRace, type SimulationSettings } from './historical-simulator'

const settings: SimulationSettings = { startingBankroll: 100, method: 'flat', flatStake: 10, stakePercent: 1 }
const filters = { WIN: { ...DEFAULT_SIMULATION_FILTERS }, PLACE: { ...DEFAULT_SIMULATION_FILTERS } }
const race: SimulationRace = { id: 'race', start: '2026-09-01T01:00:00Z', settledAt: '2026-09-01T01:10:00Z', venue: 'Test', state: 'VIC', number: 1, fieldSize: 8,
  selections: [{ id: 'horse', horse: 'Runner', model: 'model', rank: 1, predictedAt: '2026-09-01T00:00:00Z', winProbability: 0.4, top3Probability: 0.7, reliability: null, winOdds: 3, placeOdds: 2, winSource: 'racing_com', placeSource: 'racing_com', position: 2, scratched: false, winIssue: null, placeIssue: null }] }

it('explains hidden winners without adding them to the simulated portfolio', () => {
  const source = { ...race, selections: [{ ...race.selections[0], horse: 'Vantaa', winProbability: 0.40545, winOdds: 2.1, position: 1 }] }
  const candidates = simulationCandidates([source])
  const result = simulateBets(candidates, filters, settings)
  const winner = candidates[0]
  expect(result.bets.some(bet => bet.id === winner.id)).toBe(false)
  expect(simulationExclusionReasons(winner, filters.WIN, false)).toEqual(['Edge below selected threshold or unavailable'])
  expect(simulationExclusionReasons({ ...winner, issue: 'Ambiguous or dead-heat result', selection: { ...winner.selection, top3Probability: 0.3 } }, filters.WIN, false)).toEqual([
    'Edge below selected threshold or unavailable', 'Top-three probability below selected threshold or unavailable', 'Ambiguous or dead-heat result',
  ])
  expect(winner.stake).toBe(0)
  expect(simulationExclusionReasons({ ...winner, edge: 10 }, { ...filters.WIN, onePerRace: true }, false)).toEqual(['Another runner selected by the one-pick-per-race rule'])
})

it('ranks the complete TAB market, retains joint favourites, and rejects partial or stale fields', () => {
  const field = { ...race, selections: Array.from({ length: 8 }, (_, index) => ({ ...race.selections[0], id: String(index), rank: 8 - index,
    fullField: true, winOdds: index < 2 ? 2 : index + 2, winSource: 'tab', placeSource: 'tab',
    tabQuotedAt: '2026-09-01T00:55:00Z', tabCapturedAt: '2026-09-01T00:56:00Z' })) }
  const candidates = simulationCandidates([field]).filter(bet => bet.market === 'PLACE')
  expect(candidates.map(bet => bet.tabMarketRank)).toEqual([1, 1, 3, 4, 5, 6, 7, 8])
  const middle = { ...filters.PLACE, maxRank: 0, minTabMarketRank: 2, maxTabMarketRank: 4 }
  expect(candidates.filter(bet => matchesSimulationFilters(bet, middle)).map(bet => bet.selection.id)).toEqual(['2', '3'])
  expect(simulationCandidates([{ ...field, selections: field.selections.slice(1) }]).every(bet => bet.tabMarketRank === null)).toBe(true)
  field.selections[0].tabCapturedAt = '2026-09-01T00:56:30Z'
  expect(simulationCandidates([field]).every(bet => bet.tabMarketRank === null)).toBe(true)
  field.selections[0].tabCapturedAt = '2026-09-01T00:56:00Z'
  field.selections[0].tabQuotedAt = '2026-09-01T00:30:00Z'
  expect(simulationCandidates([field]).every(bet => bet.tabMarketRank === null)).toBe(true)
})

it('limits each model and market to its highest-value qualifying runner without using the outcome', () => {
  const source = { ...race, selections: [...race.selections, { ...race.selections[0], id: 'better-value', top3Probability: 0.8, position: 8 }] }
  const result = simulateBets(simulationCandidates([source]), { WIN: { ...filters.WIN, enabled: false }, PLACE: { ...filters.PLACE, onePerRace: true } }, settings)
  expect(result.bets).toHaveLength(1)
  expect(result.bets[0]).toMatchObject({ selection: { id: 'better-value' }, status: 'LOST', stake: 10 })
})

it.each([-2, -5, -10, -15, -20])('applies the strict negative edge threshold %s to both markets', minEdge => {
  for (const bet of simulationCandidates([race])) {
    const filter = { ...filters[bet.market], minEdge }
    expect(matchesSimulationFilters({ ...bet, edge: minEdge + 0.01 }, filter)).toBe(true)
    expect(matchesSimulationFilters({ ...bet, edge: minEdge }, filter)).toBe(false)
    expect(matchesSimulationFilters({ ...bet, edge: minEdge - 0.01 }, filter)).toBe(false)
    expect(matchesSimulationFilters({ ...bet, edge: null }, filter)).toBe(false)
  }
})

it('supports inclusive legacy boundaries, field minimum, frozen qualification and decision window', () => {
  const bet = { ...simulationCandidates([race])[1], source: 'tab', edge: 5, selection: { ...race.selections[0], top3Probability: 0.6, tabCapturedAt: '2026-09-01T00:55:00Z' } }
  const filter = { ...DEFAULT_SIMULATION_FILTERS, inclusiveThresholds: true, minEdge: 5, minTop3: 60, minimumFieldSize: 8, maxOdds: 15, minMinutesToJump: 1, maxMinutesToJump: 180 }
  expect(matchesSimulationFilters(bet, filter)).toBe(true)
  expect(matchesSimulationFilters(bet, { ...filter, minimumFieldSize: 10 })).toBe(false)
  expect(matchesSimulationFilters(bet, { ...filter, requireQualifiedWin: true })).toBe(false)
  expect(matchesSimulationFilters({ ...bet, selection: { ...bet.selection, qualifiedWin: true } }, { ...filter, requireQualifiedWin: true })).toBe(true)
  expect(matchesSimulationFilters({ ...bet, selection: { ...bet.selection, tabCapturedAt: undefined } }, filter)).toBe(false)
  expect(matchesSimulationFilters({ ...bet, probability: 1 }, { ...filter, positiveValueOnly: true })).toBe(false)
  expect(matchesSimulationFilters({ ...bet, probability: 0.1 }, { ...filter, positiveValueOnly: true })).toBe(false)
})

it('creates both markets and applies strict default probability and edge thresholds', () => {
  const bets = simulationCandidates([race])
  expect(bets).toHaveLength(2)
  expect(matchesSimulationFilters(bets[0], filters.WIN)).toBe(true)
  expect(matchesSimulationFilters({ ...bets[0], edge: 0 }, filters.WIN)).toBe(false)
  expect(matchesSimulationFilters({ ...bets[0], selection: { ...bets[0].selection, top3Probability: 0.5 } }, filters.WIN)).toBe(false)
  expect(matchesSimulationFilters(bets[0], { ...filters.WIN, minReliability: 50 })).toBe(false)
})

it('excludes legacy or stale TAB quotes even when reading an old cached report', () => {
  for (const timestamps of [{}, { tabQuotedAt: '2026-09-01T00:40:00Z', tabCapturedAt: '2026-09-01T00:41:00Z' }, { tabQuotedAt: '2026-09-01T00:55:00Z', tabCapturedAt: '2026-09-01T01:01:00Z' }]) {
    const candidates = simulationCandidates([{ ...race, selections: [{ ...race.selections[0], winSource: 'tab', placeSource: 'tab', ...timestamps }] }])
    expect(simulateBets(candidates, filters, settings).summaries[0]).toMatchObject({ excluded: 2, bets: 0 })
  }
  const valid = { ...race, selections: [{ ...race.selections[0], winSource: 'tab', placeSource: 'tab', tabQuotedAt: '2026-09-01T00:55:00Z', tabCapturedAt: '2026-09-01T00:56:00Z' }] }
  expect(simulateBets(simulationCandidates([valid]), filters, settings).summaries[0].bets).toBe(2)
})

it('calculates stake-weighted ROI from all filtered results without changing source data', () => {
  const candidates = simulationCandidates([race])
  const result = simulateBets(candidates, filters, settings)
  expect(result.summaries[0]).toMatchObject({ bets: 2, wins: 1, staked: 20, profit: 0, roi: 0, bankroll: 100, maxDrawdown: 0 })
  expect(candidates.every(bet => bet.stake === 0)).toBe(true)
  expect(simulateBets(candidates, { ...filters, WIN: { ...filters.WIN, enabled: false } }, settings).summaries[0]).toMatchObject({ staked: 10, profit: 10, roi: 100 })
})

it.each(['WIN', 'PLACE'] as const)('applies a strict less-than field size limit to %s', market => {
  const candidates = simulationCandidates([7, 8, 9].map(fieldSize => ({ ...race, id: `race-${fieldSize}`, fieldSize }))).filter(bet => bet.market === market)
  expect(candidates.filter(bet => matchesSimulationFilters(bet, { ...filters[market], maxField: 8 })).map(bet => bet.race.fieldSize)).toEqual([7])
  expect(candidates.filter(bet => matchesSimulationFilters(bet, filters[market]))).toHaveLength(3)
})

it('keeps WIN and PLACE field size limits independent', () => {
  const selected = { WIN: { ...filters.WIN, maxField: 8 }, PLACE: { ...filters.PLACE, maxField: 10 } }
  const candidates = simulationCandidates([race])
  expect(candidates.filter(bet => matchesSimulationFilters(bet, selected[bet.market])).map(bet => bet.market)).toEqual(['PLACE'])
})

it('excludes unsupported settlements and refunds scratches without inflating ROI turnover', () => {
  const source = { ...race, selections: [{ ...race.selections[0], scratched: true, placeIssue: 'Two-place market' }] }
  const result = simulateBets(simulationCandidates([source]), filters, settings)
  expect(result.summaries[0]).toMatchObject({ bets: 0, roi: null, refunded: 1, excluded: 1, bankroll: 100 })
})

it('apportions same-race bets within bankroll and settles before replaying the next race', () => {
  const later = { ...race, id: 'later', start: '2026-09-01T01:05:00Z', settledAt: null }
  const result = simulateBets(simulationCandidates([race, later]), filters, { ...settings, startingBankroll: 10 })
  expect(result.bets.filter(bet => bet.race.id === 'race').map(bet => bet.stake)).toEqual([5, 5])
  expect(result.bets.filter(bet => bet.race.id === 'later').map(bet => bet.stake)).toEqual([5, 5])
  expect(result.summaries[0]).toMatchObject({ bankroll: 10, unfunded: 0 })
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

it('recycles a $50 bankroll at $1 flat stakes across 100 settled races without losing cents', () => {
  const races = Array.from({ length: 100 }, (_, index) => ({
    ...race, id: `race-${index}`,
    start: new Date(Date.parse(race.start) + index * 20 * 60_000).toISOString(),
    settledAt: new Date(Date.parse(race.start) + (index * 20 + 10) * 60_000).toISOString(),
  }))
  const result = simulateBets(simulationCandidates(races), filters, { ...settings, startingBankroll: 50, flatStake: 1 })
  expect(result.summaries[0]).toMatchObject({ bets: 200, staked: 200, profit: 0, bankroll: 50, roi: 0, unfunded: 0 })
  expect(result.bets.every(bet => bet.stake === 1)).toBe(true)
})

it('does not let late result ingestion starve a $50 bankroll at $1 stakes', () => {
  const races = Array.from({ length: 100 }, (_, index) => ({
    ...race, id: `race-${index}`,
    start: new Date(Date.parse(race.start) + index * 20 * 60_000).toISOString(),
    settledAt: '2026-09-20T00:00:00Z',
  }))
  const result = simulateBets(simulationCandidates(races), filters, { ...settings, startingBankroll: 50, flatStake: 1 })
  expect(result.summaries[0]).toMatchObject({ bets: 200, staked: 200, profit: 0, bankroll: 50, unfunded: 0 })
})

it('stops spending when a $50 bankroll genuinely loses its funds at $1 stakes', () => {
  const races = Array.from({ length: 100 }, (_, index) => ({
    ...race, id: `race-${index}`, start: new Date(Date.parse(race.start) + index * 20 * 60_000).toISOString(),
    selections: [{ ...race.selections[0], position: 4 }],
  }))
  expect(simulateBets(simulationCandidates(races), filters, { ...settings, startingBankroll: 50, flatStake: 1 }).summaries[0]).toMatchObject({ bets: 50, staked: 50, profit: -50, bankroll: 0, roi: -100, unfunded: 150, maxDrawdown: 100 })
})

it('rounds decimal flat stakes to cents instead of truncating floating-point errors', () => {
  const result = simulateBets(simulationCandidates([race]), filters, { ...settings, startingBankroll: 50, flatStake: 1.15 })
  expect(result.bets.map(bet => bet.stake)).toEqual([1.15, 1.15])
  expect(result.summaries[0]).toMatchObject({ staked: 2.3, profit: 0, bankroll: 50 })
})