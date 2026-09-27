import { expect, it } from 'vitest'
import { DEFAULT_SIMULATION_FILTERS } from './historical-simulator'
import { DEFAULT_SIMULATION_SETTINGS, readSimulationPreferences } from './simulation-preferences'

it.each([null, '', '{broken', 'null', '[]', '{"schema":2,"count":100}'])('uses defaults for absent, malformed or unsupported saved preferences: %s', serialized => {
  expect(readSimulationPreferences(serialized)).toEqual({
    schema: 1, filters: { WIN: DEFAULT_SIMULATION_FILTERS, PLACE: DEFAULT_SIMULATION_FILTERS },
    settings: DEFAULT_SIMULATION_SETTINGS, count: 500, sort: 'start',
  })
})

it('round trips independent market filters and all simulator controls', () => {
  const preferences = readSimulationPreferences(null)
  preferences.filters.WIN = { enabled: false, minReliability: 80, minEdge: -100, minImplied: 20, maxImplied: 70, minWin: 30, minTop3: 60, model: 'v5-trained', rank: 2, minOdds: 1.5, maxOdds: 20, source: 'tab', venue: 'Flemington', minField: 8 }
  preferences.filters.PLACE.minTop3 = 70
  preferences.settings = { startingBankroll: 0, flatStake: 0, method: 'kelly-0.25', stakePercent: 0.5 }
  preferences.count = 1000
  preferences.sort = 'edge'
  expect(readSimulationPreferences(JSON.stringify(preferences))).toEqual(preferences)
  expect(DEFAULT_SIMULATION_FILTERS.minTop3).toBe(50)
})

it('keeps valid fields and defaults invalid or missing fields independently', () => {
  const preferences = readSimulationPreferences(JSON.stringify({
    schema: 1, count: 123, sort: 'unknown', filters: { WIN: { enabled: 'false', minTop3: 55, model: [], rank: 9, source: 'unknown', minEdge: -1 }, PLACE: { minTop3: 80 } },
    settings: { startingBankroll: -1, flatStake: '10', method: 'percent', stakePercent: 101 },
  }))
  expect(preferences.filters.WIN).toEqual(DEFAULT_SIMULATION_FILTERS)
  expect(preferences.filters.PLACE.minTop3).toBe(80)
  expect(preferences.settings).toEqual({ ...DEFAULT_SIMULATION_SETTINGS, method: 'percent' })
  expect(preferences.count).toBe(500)
  expect(preferences.sort).toBe('start')
})

it('rejects nonfinite and oversized monetary values', () => {
  expect(readSimulationPreferences('{"schema":1,"settings":{"startingBankroll":1e999,"flatStake":1e100}}').settings).toEqual(DEFAULT_SIMULATION_SETTINGS)
})