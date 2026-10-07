import { expect, it } from 'vitest'
import { buildTabBatchPreview, formatTabBatchBet, type TabBatchRace } from './tab-batch'
import { picksHistoryPreset } from './simulation-presets'
import type { SimulationRace } from './historical-simulator'

it('matches TAB documented WIN and PLACE bet strings', () => {
  expect(formatTabBatchBet('SR', 1, 1, 5, 0)).toBe('SR-01-WP-00005.0-00000.0/1/')
  expect(formatTabBatchBet('AR', 3, 3, 0, 0.5)).toBe('AR-03-WP-00000.0-00000.5/3/')
  expect(formatTabBatchBet('MR', 2, 12, 4, 2.5)).toBe('MR-02-WP-00004.0-00002.5/12/')
  expect(formatTabBatchBet('ER', 2, 12, 4, 0)).toBe('ER-02-WP-00004.0-00000.0/12/')
})

it('rejects unsupported identifiers, zero bets and silently rounded stakes', () => {
  for (const code of ['FLEM', 'MR\nSR', 'XX', 'SR ']) expect(() => formatTabBatchBet(code, 1, 1, 5, 0)).toThrow()
  for (const stake of [0, -1, 0.01, 5.55, NaN, Infinity, 100000]) expect(() => formatTabBatchBet('SR', 1, 1, stake, 0)).toThrow()
  expect(() => formatTabBatchBet('SR', 13, 1, 5, 0)).toThrow()
  expect(() => formatTabBatchBet('SR', 1, 25, 5, 0)).toThrow()
})

const now = new Date('2026-10-07T01:00:00Z')
const race: SimulationRace = { id: 'race', start: '2026-10-07T02:00:00Z', settledAt: null, venue: 'Test', state: 'VIC', number: 1, fieldSize: 8, selections: [],
  historySelections: [{ id: 'horse', horse: 'Runner (AUS)', model: 'model', rank: 1, predictedAt: '2026-10-07T00:00:00Z', forecastBasis: 'history', historyObservedAt: '2026-10-07T00:10:00Z',
    winProbability: 0.6, top3Probability: 0.8, reliability: null, winOdds: 3, placeOdds: 2, winSource: 'racing_com', placeSource: 'racing_com', position: null, scratched: false, winIssue: 'Incomplete results', placeIssue: 'Incomplete results' }] }
const tab: TabBatchRace = { id: 'race', code: 'MR', start: race.start, number: 1, venue: 'Test', winOpen: true, placeOpen: true, runners: [{ number: 4, name: 'RUNNER', open: true }] }

it('exports upcoming retained selections without fabricating outcomes or selecting a later forecast', () => {
  const result = buildTabBatchPreview([race], [tab], picksHistoryPreset(), 'VIC', now)
  expect(result.text).toBe('MR-01-WP-00010.0-00000.0/4/')
  expect(result.total).toBe(10)
  expect(result.rows[0]).toMatchObject({ model: 'model', market: 'WIN', runner: 4 })
  expect(result.expiresAt).toBe('2026-10-07T01:02:00.000Z')
})

it('exports exact flat-stake Tote bets even when TAB settlement is selected and no historical prices exist', () => {
  const preferences = picksHistoryPreset()
  preferences.filters.WIN.settlementOdds = 'tab'
  preferences.filters.PLACE = { ...preferences.filters.WIN }
  const unpriced = { ...race, historySelections: [{ ...race.historySelections![0], winOdds: null, placeOdds: null, tabPrice: null }] }
  const originalPreferences = structuredClone(preferences)
  const result = buildTabBatchPreview([unpriced], [tab], preferences, 'VIC', now)
  expect(result.rows).toHaveLength(2)
  expect(result.rows.find(row => row.market === 'WIN')?.line).toBe('MR-01-WP-00010.0-00000.0/4/')
  expect(result.rows.find(row => row.market === 'PLACE')?.line).toBe('MR-01-WP-00000.0-00010.0/4/')
  expect(result.total).toBe(20)
  expect(result.excluded).toEqual([])
  expect(preferences).toEqual(originalPreferences)
  expect(unpriced.historySelections[0].tabPrice).toBeNull()
  expect(result.warnings).toContainEqual(expect.stringContaining('not historical settlement odds'))
  expect(buildTabBatchPreview([unpriced], [{ ...tab, winOpen: false, placeOpen: false }], preferences, 'VIC', now).rows).toEqual([])
  expect(buildTabBatchPreview([unpriced], [{ ...tab, runners: [{ ...tab.runners[0], open: false }] }], preferences, 'VIC', now).rows).toEqual([])
})

it('still requires configured TAB reference quotes for custom History filters', () => {
  const preferences = picksHistoryPreset()
  preferences.filters.WIN = { ...preferences.filters.WIN, forecast: 'history', settlementOdds: 'tab' }
  const result = buildTabBatchPreview([{ ...race, historySelections: [{ ...race.historySelections![0], fullField: true }] }], [tab], preferences, 'VIC', now)
  expect(result.text).toBe('')
  expect(result.excluded[0].reason).toBe('Configured TAB reference quote unavailable')
})

it('excludes started, tomorrow, scratched, ambiguous and closed TAB runners', () => {
  expect(buildTabBatchPreview([{ ...race, start: now.toISOString() }, { ...race, start: '2026-10-08T02:00:00Z' }], [tab], picksHistoryPreset(), 'VIC', now).rows).toEqual([])
  for (const override of [{ winOpen: false }, { runners: [{ ...tab.runners[0], open: false }] }, { runners: [...tab.runners, ...tab.runners] }, { start: now.toISOString() }]) {
    const result = buildTabBatchPreview([race], [{ ...tab, ...override }], picksHistoryPreset(), 'VIC', now)
    expect(result.text).toBe('')
    expect(result.excluded).toHaveLength(1)
  }
})

it('keeps WIN and PLACE stakes separate and rejects unsupported staking, duplicate models and excessive combined exposure', () => {
  const preferences = picksHistoryPreset()
  preferences.filters.PLACE = { ...preferences.filters.WIN }
  expect(buildTabBatchPreview([race], [tab], preferences, 'NSW', now).total).toBe(20)
  for (const method of ['percent', 'kelly-0.10'] as const) expect(() => buildTabBatchPreview([race], [tab], { ...preferences, settings: { ...preferences.settings, method } }, 'VIC', now)).toThrow('flat stakes')
  const duplicate = { ...race, historySelections: [...race.historySelections!, { ...race.historySelections![0], model: 'other' }] }
  expect(() => buildTabBatchPreview([duplicate], [tab], preferences, 'VIC', now)).toThrow('Multiple model')
  expect(() => buildTabBatchPreview([race], [tab], { ...preferences, settings: { ...preferences.settings, startingBankroll: 10 } }, 'VIC', now)).toThrow('Combined batch stake')
})