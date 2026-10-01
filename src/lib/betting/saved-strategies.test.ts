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