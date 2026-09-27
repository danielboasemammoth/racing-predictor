import { expect, it } from 'vitest'
import { buildSimulationRace, type SimulationSource } from './simulation-source'

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