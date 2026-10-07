import { expect, it } from 'vitest'
import { legacySimulationPreset, picksHistoryPreset } from './simulation-presets'
import { readSavedStrategies, saveStrategy } from './saved-strategies'
import { readSimulationPreferences } from './simulation-preferences'
import { DEFAULT_THRESHOLDS } from './recommendation-engine'

it('matches the existing internal WIN and PLACE policy without weakening missing evidence gates', () => {
  const WIN = legacySimulationPreset('WIN')
  const PLACE = legacySimulationPreset('PLACE')
  expect(WIN).toMatchObject({ rank: 1, minReliability: 80, requireQualifiedWin: true, minTop3: 0, inclusiveThresholds: true })
  expect(PLACE).toMatchObject({ rank: 0, maxRank: 0, minTop3: 60, minimumFieldSize: 8, requireQualifiedWin: false })
  expect(PLACE.minEdge).toBe(DEFAULT_THRESHOLDS.minEdgePoints)
  expect(PLACE.maxOdds).toBe(DEFAULT_THRESHOLDS.maxOdds)
  expect(readSimulationPreferences(JSON.stringify({ schema: 1, filters: { WIN, PLACE } })).filters).toEqual({ WIN, PLACE })
})

it('round-trips the exact Picks History preset through saved strategies', () => {
  const preferences = picksHistoryPreset()
  expect(preferences.filters.WIN).toMatchObject({ enabled: true, forecast: 'picks-history', minEdge: -100, minTop3: 0 })
  expect(preferences.filters.PLACE.enabled).toBe(false)
  expect(readSavedStrategies(JSON.stringify(saveStrategy([], 'Picks History', preferences)))[0].preferences).toEqual(preferences)
})