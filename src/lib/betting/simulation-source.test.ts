import { expect, it } from 'vitest'
import { buildSimulationRace, type SimulationSource } from './simulation-source'
import type { SimulationDecision } from './simulation-decision'
import { DEFAULT_SIMULATION_FILTERS, simulateBets, simulationBetProvider, simulationCandidates } from './historical-simulator'

const source: SimulationSource = {
  id: 'race', start: '2026-09-01T01:00:00Z', settledAt: '2026-09-01T02:00:00Z', venue: 'Test', state: 'VIC', number: 1,
  entries: Array.from({ length: 8 }, (_, index) => ({ horse_id: `horse-${index}`, position: index + 1, status: 'finished' })),
  forecasts: [{ id: 'forecast', model: 'model', predictedAt: '2026-09-01T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', field: Array.from({ length: 8 }, (_, index) => `horse-${index}`),
    podium: Array.from({ length: 3 }, (_, index) => ({ horse_id: `horse-${index}`, horse_name: `Runner ${index}`, predicted_position: index + 1, confidence: 0.6, win_probability: 0.4, top3_probability: 0.7, win_odds: 3, place_odds: 2 })) }],
}

it('extracts three selections without fabricating historical reliability or TAB provenance', () => {
  const race = buildSimulationRace(source)
  expect(race.selections).toHaveLength(3)
  expect(race.selections[0]).toMatchObject({ reliability: null, winSource: 'racing_com', winIssue: null, placeIssue: null })
})

it('replaces prices with verified near-start TAB quotes without changing the pre-race forecast', () => {
  const quotes = new Map([['runner 0', { win: 4, place: 2.5, capturedAt: '2026-09-01T00:59:00Z', quotedAt: '2026-09-01T00:58:30Z' }]])
  expect(buildSimulationRace(source, quotes).selections[0]).toMatchObject({ winOdds: 4, placeOdds: 2.5, winSource: 'tab', placeSource: 'tab', winProbability: 0.4, top3Probability: 0.7, predictedAt: source.forecasts[0].predictedAt, tabQuotedAt: '2026-09-01T00:58:30Z' })
  expect(source.forecasts[0].podium[0].win_odds).toBe(3)
})

it('does not reuse timestamp-free TAB prices from frozen predictions', () => {
  const old = { ...source, forecasts: [{ ...source.forecasts[0], podium: [{ ...source.forecasts[0].podium[0], win_odds_source: 'tab' as const, place_odds_source: 'tab' as const }] }] }
  expect(buildSimulationRace(old).selections[0]).toMatchObject({ winOdds: null, placeOdds: null, winSource: 'tab', placeSource: 'tab', tabQuotedAt: null })
})

it('rejects retrospective, late-generated and backdated forecasts', () => {
  for (const override of [{ model: 'model-retrospective' }, { predictedAt: source.start }, { createdAt: source.start }]) {
    expect(buildSimulationRace({ ...source, forecasts: [{ ...source.forecasts[0], ...override }] }).selections).toEqual([])
  }
})

it('excludes changed fields, dead heats, incomplete results and two-place markets', () => {
  expect(buildSimulationRace({ ...source, forecasts: [{ ...source.forecasts[0], field: [] }] }).selections[0].winIssue).toContain('Changed field')
  expect(buildSimulationRace({ ...source, entries: source.entries.map(entry => ({ ...entry, position: 1 })) }).selections[0].winIssue).toContain('dead-heat')
  expect(buildSimulationRace({ ...source, entries: source.entries.map(entry => ({ ...entry, position: null })) }).selections[0].winIssue).toContain('Incomplete')
  const small = { ...source, entries: source.entries.slice(0, 7), forecasts: [{ ...source.forecasts[0], field: source.forecasts[0].field.slice(0, 7) }] }
  expect(buildSimulationRace(small).selections[0]).toMatchObject({ winIssue: null, placeIssue: 'Top-three probability does not match paid places' })
})

it('includes all forecast runners only when supplied and marks complete full-field coverage', () => {
  const allHorses = source.entries.map((entry, index) => ({ ...source.forecasts[0].podium[0], horse_id: entry.horse_id, predicted_position: index + 1 }))
  const race = buildSimulationRace({ ...source, forecasts: [{ ...source.forecasts[0], allHorses }] })
  expect(race.selections).toHaveLength(8)
  expect(race.selections.every(selection => selection.fullField)).toBe(true)
  expect(buildSimulationRace(source).selections.every(selection => !selection.fullField)).toBe(true)
})

it('does not reject an outright WIN because other runners tied for third', () => {
  const entries = source.entries.map((entry, index) => ({ ...entry, position: index === 3 ? 3 : entry.position }))
  const race = buildSimulationRace({ ...source, entries })
  expect(race.selections[0]).toMatchObject({ position: 1, winIssue: null, placeIssue: 'Ambiguous or dead-heat result' })
  const changed = buildSimulationRace({ ...source, entries, forecasts: [{ ...source.forecasts[0], field: [] }] })
  expect(changed.selections[0].winIssue).toBe('Changed field; deductions unverified')
  const capturedAt = '2026-09-01T00:59:00Z'
  const decision: SimulationDecision = { schema: 1, raceId: source.id, start: source.start, capturedAt,
    forecast: { ...source.forecasts[0], evidence: { predictionId: 'forecast', horseId: 'horse-0', capturedAt, reliability: 85, qualifiedWin: true } },
    prices: { 'horse-0': { win: 3, place: 2, quotedAt: capturedAt, capturedAt,
      placeTerms: { source: 'TAB', product: 'fixed-place', paidPlaces: 3, fieldSize: 8, capturedAt } } } }
  expect(buildSimulationRace({ ...source, entries, decisions: [decision] }).decisionSelections![0])
    .toMatchObject({ winIssue: null, placeIssue: 'Ambiguous or dead-heat result', placeTermsVerified: true })
})

it('accepts only matching genuinely pre-race frozen qualification evidence', () => {
  const evidence = { predictionId: 'forecast', horseId: 'horse-0', capturedAt: '2026-09-01T00:50:00Z', reliability: 85, qualifiedWin: true }
  const build = (override = {}) => buildSimulationRace({ ...source, forecasts: [{ ...source.forecasts[0], evidence: { ...evidence, ...override } }] }).selections[0]
  expect(build()).toMatchObject({ reliability: 85, qualifiedWin: true, evaluatedAt: evidence.capturedAt })
  for (const override of [{ capturedAt: source.start }, { capturedAt: '2026-08-31T00:00:00Z' }, { predictionId: 'other' }, { horseId: 'other' }]) {
    expect(build(override)).toMatchObject({ reliability: null, qualifiedWin: null, evaluatedAt: null })
  }
})

it('replays the frozen decision forecast and quote instead of the latest forecast or near-start price', () => {
  const capturedAt = '2026-09-01T00:30:00Z'
  const decision: SimulationDecision = { schema: 1, raceId: source.id, start: source.start, capturedAt,
    forecast: { ...source.forecasts[0], podium: source.forecasts[0].podium.map(horse => ({ ...horse, win_probability: 0.25 })),
      evidence: { predictionId: 'forecast', horseId: 'horse-0', capturedAt, reliability: 85, qualifiedWin: true } },
    prices: { 'horse-0': { win: 6, place: 3, quotedAt: '2026-09-01T00:29:00Z', capturedAt: '2026-09-01T00:29:30Z' } } }
  const race = buildSimulationRace({ ...source, decisions: [decision] })
  expect(race.selections[0].winProbability).toBe(0.4)
  expect(race.decisionSelections?.[0]).toMatchObject({ winProbability: 0.25, winOdds: 6, placeOdds: 3, winSource: 'tab_decision', reliability: 85, evaluatedAt: capturedAt })
  expect(race.decisionSelections?.[1]).toMatchObject({ winOdds: null, winIssue: 'Missing or stale TAB decision quote' })
  for (const override of [{ start: '2026-09-01T02:00:00Z' }, { forecast: { ...decision.forecast, createdAt: '2026-09-01T00:31:00Z' } }]) {
    expect(buildSimulationRace({ ...source, decisions: [{ ...decision, ...override }] }).decisionSelections).toEqual([])
  }
})

it('keeps frozen market-specific provider codes, with no attribution guessed for older forecasts', () => {
  const supplied = { ...source, forecasts: [{ ...source.forecasts[0], podium: [{ ...source.forecasts[0].podium[0], win_odds_provider: 'SB2', place_odds_provider: 'PB3' }] }] }
  const bets = simulationCandidates([buildSimulationRace(supplied)])
  expect(simulationBetProvider(bets[0])).toBe('Sportsbet (SB2)')
  expect(simulationBetProvider(bets[1])).toBe('PointsBet (PB3)')
  expect(simulationBetProvider(simulationCandidates([buildSimulationRace(source)])[0])).toBe('Provider not recorded')
  const tab = buildSimulationRace(supplied, new Map([['runner 0', { win: 4, place: 2, capturedAt: '2026-09-01T00:59:00Z', quotedAt: '2026-09-01T00:58:30Z' }]]))
  expect(simulationBetProvider(simulationCandidates([tab])[0])).toBe('TAB')
})

it('requires verified matching terms for seven-runner PLACE and settles top-two rather than top-three', () => {
  const allHorses = source.entries.slice(0, 7).map((entry, index) => ({ ...source.forecasts[0].podium[0], horse_id: entry.horse_id, horse_name: `Runner ${index}`, predicted_position: index + 1, win_probability: 1 / 7, top3_probability: 3 / 7 }))
  const capturedAt = '2026-09-01T00:59:00Z'
  const forecast = { ...source.forecasts[0], allHorses, podium: allHorses.slice(0, 3), field: allHorses.map(horse => horse.horse_id), evidence: { predictionId: 'forecast', horseId: 'horse-0', capturedAt, reliability: 85, qualifiedWin: true } }
  const decision: SimulationDecision = { schema: 1, raceId: source.id, start: source.start, capturedAt, forecast,
    prices: Object.fromEntries(allHorses.map(horse => [horse.horse_id, { win: 7, place: 4, quotedAt: capturedAt, capturedAt,
      placeTerms: { source: 'TAB', product: 'fixed-place', paidPlaces: 2, fieldSize: 7, capturedAt } }])) }
  const build = () => buildSimulationRace({ ...source, entries: source.entries.slice(0, 7), forecasts: [forecast], decisions: [decision] })
  const small = build()
  expect(small.decisionSelections!.every(selection => selection.placeTermsVerified && selection.placeIssue === null)).toBe(true)
  expect(small.decisionSelections![0].top2Probability).toBeCloseTo(2 / 7)
  const filter = { ...DEFAULT_SIMULATION_FILTERS, source: 'tab_decision', minTop3: 0, minEdge: -100, maxRank: 0 }
  const result = simulateBets(simulationCandidates([small]), { WIN: { ...filter, enabled: false }, PLACE: filter }, { startingBankroll: 100, method: 'flat', flatStake: 1, stakePercent: 1 })
  expect(result.summaries[0]).toMatchObject({ bets: 7, wins: 2, staked: 7, profit: 1 })
  expect(result.bets.find(bet => bet.selection.position === 3)?.status).toBe('LOST')
  decision.prices['horse-0'].placeTerms!.fieldSize = 8
  expect(build().decisionSelections![0]).toMatchObject({ placeTermsVerified: false, placeIssue: 'Top-three probability does not match paid places' })
  delete decision.prices['horse-0'].placeTerms
  expect(build().decisionSelections![0].placeTermsVerified).toBe(false)
})

it('replays only retained History picks with their earlier probabilities and prices, without changing defaults', () => {
  const early = { ...source.forecasts[0], id: 'early', predictedAt: '2026-08-31T23:00:00Z', createdAt: '2026-08-31T23:01:00Z',
    podium: source.forecasts[0].podium.map(horse => ({ ...horse, win_probability: 0.63, win_odds: 2 })) }
  const history: SimulationSource['history'] = [{ forecast: early, horseId: 'horse-0', winProbability: 0.63, top3Probability: 0.8,
    observedAt: early.createdAt, provenance: 'pre-race-recovery' }]
  const race = buildSimulationRace({ ...source, history }, new Map([['runner 0', { win: 8, capturedAt: '2026-09-01T00:59:00Z', quotedAt: '2026-09-01T00:58:30Z' }]]))
  expect(race.historySelections).toHaveLength(1)
  expect(race.historySelections![0]).toMatchObject({ predictionId: 'early', winProbability: 0.63, top3Probability: 0.8, winOdds: 2, winSource: 'racing_com', reliability: null })
  const candidates = simulationCandidates([race])
  const settings = { startingBankroll: 100, method: 'flat' as const, flatStake: 10, stakePercent: 1 }
  const filters = { WIN: { ...DEFAULT_SIMULATION_FILTERS }, PLACE: { ...DEFAULT_SIMULATION_FILTERS, enabled: false } }
  expect(simulateBets(candidates, filters, settings).bets.every(bet => bet.selection.forecastBasis !== 'history')).toBe(true)
  const result = simulateBets(candidates, { ...filters, WIN: { ...filters.WIN, forecast: 'history' } }, settings)
  expect(result.bets).toHaveLength(1)
  expect(result.bets[0]).toMatchObject({ odds: 2, status: 'WON', profit: 10, selection: { predictionId: 'early' } })
  expect(simulateBets(candidates, { ...filters, WIN: { ...filters.WIN, forecast: 'history', source: 'tab' } }, settings).bets).toHaveLength(0)
  const deadHeat = buildSimulationRace({ ...source, history, entries: source.entries.map(entry => ({ ...entry, position: 1 })) })
  expect(deadHeat.historySelections![0].winIssue).toContain('dead-heat')
  expect(buildSimulationRace({ ...source, history: [{ ...history[0], observedAt: source.start }] }).historySelections).toEqual([])
})

it('retains only selection-time TAB quotes for History, separately from original settlement prices', () => {
  const tabPrice = { win: 2.4, place: 1.3, capturedAt: '2026-09-01T00:00:30Z', quotedAt: '2026-09-01T00:00:20Z' }
  const pick = { forecast: source.forecasts[0], horseId: 'horse-0', winProbability: 0.6, top3Probability: 0.8,
    observedAt: '2026-09-01T00:01:00Z', provenance: 'home-snapshot' as const, tabPrice, tabPriceStatus: 'captured' as const }
  const later = new Map([['runner 0', { ...tabPrice, win: 99, capturedAt: '2026-09-01T00:59:00Z', quotedAt: '2026-09-01T00:58:30Z' }]])
  const race = buildSimulationRace({ ...source, history: [pick] }, later)
  expect(race.selections[0].tabPrice?.win).toBe(99)
  expect(race.historySelections![0]).toMatchObject({ winOdds: 3, placeOdds: 2, tabPrice, tabPriceBasis: 'selection' })
  expect(buildSimulationRace({ ...source, history: [{ ...pick, tabPrice: undefined, tabPriceStatus: undefined }] }, later).historySelections![0].tabPrice).toBeNull()
  expect(buildSimulationRace({ ...source, history: [{ ...pick, tabPrice: later.get('runner 0') }] }, later).historySelections![0])
    .toMatchObject({ tabPrice: null, tabPriceStatus: 'unavailable' })
})