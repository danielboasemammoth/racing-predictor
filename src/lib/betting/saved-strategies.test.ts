import { expect, it } from 'vitest'
import { readSimulationPreferences } from './simulation-preferences'
import { readSavedStrategies, saveStrategy } from './saved-strategies'

it('saves a detached named snapshot and replaces only the same name', () => {
  const preferences = readSimulationPreferences(null)
  const initial = saveStrategy([], 'One', preferences)
  preferences.filters.WIN.minEdge = -20
  expect(initial[0].preferences.filters.WIN.minEdge).toBe(0)
  const saved = saveStrategy(saveStrategy(initial, 'Two', preferences), 'One', preferences)
  expect(saved.map(entry => entry.name)).toEqual(['One', 'Two'])
  expect(readSavedStrategies(JSON.stringify(saved))).toEqual(saved)
})

it('rejects corrupt settings rather than silently changing a saved betting strategy', () => {
  const saved = saveStrategy([], 'One', readSimulationPreferences(null))
  expect(readSavedStrategies('{bad')).toEqual([])
  expect(readSavedStrategies(JSON.stringify([{ ...saved[0], preferences: { schema: 1 } }]))).toEqual([])
  expect(() => saveStrategy([], ' ', readSimulationPreferences(null))).toThrow()
})

it('round-trips per-market TAB settlement without changing legacy strategies or accepting invalid modes', () => {
  const preferences = readSimulationPreferences(null)
  const legacy = saveStrategy([], 'Legacy', preferences)
  expect(readSavedStrategies(JSON.stringify(legacy))).toEqual(legacy)
  preferences.filters.WIN.settlementOdds = 'tab'
  preferences.filters.PLACE.settlementOdds = 'recorded'
  const saved = saveStrategy(legacy, 'TAB win', preferences)
  expect(readSavedStrategies(JSON.stringify(saved))).toEqual(saved)
  expect(readSimulationPreferences(JSON.stringify(preferences)).filters.WIN.settlementOdds).toBe('tab')
  const invalid = structuredClone(saved)
  Object.assign(invalid[0].preferences.filters.WIN, { settlementOdds: 'unknown' })
  expect(readSavedStrategies(JSON.stringify(invalid)).map(strategy => strategy.name)).toEqual(['Legacy'])
})