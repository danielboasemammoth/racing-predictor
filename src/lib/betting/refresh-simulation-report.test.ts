import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshSimulationReport } from './refresh-simulation-report'
import { readSimulationChunks, readSimulationManifest, SIMULATION_MANIFEST_PATH, SIMULATION_PRICING_VERSION } from './simulation-report'
import { CURRENT_MODEL_VERSIONS } from '../prediction-suite'

vi.mock('./simulation-report', async importOriginal => ({
  ...await importOriginal<typeof import('./simulation-report')>(),
  readSimulationChunks: vi.fn(), readSimulationManifest: vi.fn(), simulationReportBaseUrl: () => 'https://example.test/',
}))

const refs = [{ id: 'race', fingerprint: 'one' }]
const source = { id: 'race', start: '2026-01-01T00:00:00Z', settledAt: null, venue: 'Test', state: 'VIC', number: 1, entries: [], forecasts: [] }
function fixture() {
  const upload = vi.fn().mockResolvedValue({ error: null })
  const release = { eq: vi.fn().mockReturnThis(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }
  const lease = { eq: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { token: 'owned' }, error: null }) }
  const rpc = vi.fn((name: string) => {
    const result = name === 'acquire_reporting_lease' ? { data: true, error: null } : name === 'simulation_race_window' ? { data: refs, error: null } : { data: [source], error: null }
    return { ...result, abortSignal: () => Promise.resolve(result) }
  })
  const query = { delete: vi.fn(() => release), select: vi.fn(() => lease) }
  const decisions = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(), retry: vi.fn().mockResolvedValue({ data: [], error: null }) }
  const history = { eq: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(), retry: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
  decisions.select.mockImplementation((columns: string) => columns === 'payload, generated_at' ? history : decisions)
  return { db: { rpc, from: vi.fn((table: string) => table === 'analysis_snapshots' ? decisions : query), storage: { from: vi.fn(() => ({ upload })) } } as unknown as SupabaseClient, upload, rpc, query, lease, decisions, history }
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(readSimulationManifest).mockResolvedValue(null) })

it('uploads immutable chunks before the manifest and releases the lease', async () => {
  const { db, upload, query } = fixture()
  expect(await refreshSimulationReport(db)).toMatchObject({ races: 1, rebuilt: 1, skipped: false })
  expect(upload.mock.calls[0][0]).toMatch(/simulator\/v1\/[a-f0-9]{64}\.json/)
  expect(upload.mock.calls[1][0]).toBe(SIMULATION_MANIFEST_PATH)
  expect(query.delete).toHaveBeenCalled()
})

it('never switches the manifest if a chunk upload fails', async () => {
  const { db, upload, query } = fixture()
  upload.mockResolvedValue({ error: new Error('storage unavailable') })
  await expect(refreshSimulationReport(db)).rejects.toThrow('storage unavailable')
  expect(upload.mock.calls.some(call => call[0] === SIMULATION_MANIFEST_PATH)).toBe(false)
  expect(query.delete).toHaveBeenCalled()
})

it('skips unchanged reports without reloading prediction payloads or writing storage', async () => {
  vi.mocked(readSimulationManifest).mockResolvedValue({ schema: 1, pricingVersion: SIMULATION_PRICING_VERSION, generatedAt: '2026-01-01', models: [...CURRENT_MODEL_VERSIONS], chunks: [], races: refs })
  vi.mocked(readSimulationChunks).mockResolvedValue({ schema: 1, generatedAt: '2026-01-01', models: [...CURRENT_MODEL_VERSIONS], races: [{ ...source, fieldSize: 0, selections: [] }] })
  const { db, upload, rpc } = fixture()
  expect(await refreshSimulationReport(db)).toMatchObject({ skipped: true, reason: 'No source changes' })
  expect(rpc.mock.calls.some(call => call[0] === 'simulation_race_sources')).toBe(false)
  expect(upload).not.toHaveBeenCalled()
})

it('does not publish after losing its lease', async () => {
  const { db, upload, lease } = fixture()
  lease.maybeSingle.mockResolvedValue({ data: null, error: null })
  await expect(refreshSimulationReport(db)).rejects.toThrow('lease')
  expect(upload.mock.calls.some(call => call[0] === SIMULATION_MANIFEST_PATH)).toBe(false)
})

it('rebuilds legacy report prices even when source fingerprints are unchanged', async () => {
  vi.mocked(readSimulationManifest).mockResolvedValue({ schema: 1, generatedAt: '2026-01-01', models: [...CURRENT_MODEL_VERSIONS], chunks: [], races: refs })
  vi.mocked(readSimulationChunks).mockResolvedValue({ schema: 1, generatedAt: '2026-01-01', models: [...CURRENT_MODEL_VERSIONS], races: [{ ...source, fieldSize: 0, selections: [] }] })
  const { db, rpc } = fixture()
  expect(await refreshSimulationReport(db)).toMatchObject({ skipped: false, rebuilt: 1 })
  expect(rpc.mock.calls.some(call => call[0] === 'simulation_race_sources')).toBe(true)
})

it('identifies timed-out source batches while preserving the database error code', async () => {
  const { db, rpc, query } = fixture()
  const original = rpc.getMockImplementation()!
  rpc.mockImplementation(name => name === 'simulation_race_sources'
    ? { data: [], error: null, abortSignal: () => Promise.resolve({ data: null, error: { code: '57014', message: 'statement timeout' } }) } as unknown as ReturnType<typeof original>
    : original(name))
  await expect(refreshSimulationReport(db)).rejects.toMatchObject({ code: '57014', message: 'Reading race sources 1-1 of 1: statement timeout' })
  expect(query.delete).toHaveBeenCalled()
})

it('retains the previous manifest when frozen decisions cannot be read', async () => {
  const { db, upload, decisions } = fixture()
  decisions.retry.mockResolvedValue({ data: [], error: { message: 'decision storage unavailable' } })
  await expect(refreshSimulationReport(db)).rejects.toThrow('Reading frozen TAB decisions')
  expect(upload).not.toHaveBeenCalled()
})

it('publishes History coverage changes even when race fingerprints are unchanged', async () => {
  vi.mocked(readSimulationManifest).mockResolvedValue({ schema: 1, pricingVersion: SIMULATION_PRICING_VERSION, generatedAt: '2026-01-01', models: [...CURRENT_MODEL_VERSIONS], chunks: [], races: refs })
  vi.mocked(readSimulationChunks).mockResolvedValue({ schema: 1, generatedAt: '2026-01-01', models: [...CURRENT_MODEL_VERSIONS], races: [{ ...source, fieldSize: 0, selections: [] }] })
  const { db, upload, history } = fixture()
  history.maybeSingle.mockResolvedValue({ data: { generated_at: '2026-01-02T00:00:00Z', payload: [] }, error: null })
  expect(await refreshSimulationReport(db)).toMatchObject({ skipped: false, rebuilt: 0 })
  expect(JSON.parse(upload.mock.calls.at(-1)![1])).toMatchObject({ historyGeneratedAt: '2026-01-02T00:00:00Z', historyPickCount: 0 })
})

it('rebuilds a retained History pick by its original ID, including losers and without replacing missing forecasts', async () => {
  const { db, upload, history, rpc } = fixture()
  const allHorses = Array.from({ length: 8 }, (_, index) => ({ horse_id: `horse-${index}`, horse_name: `Runner ${index}`, predicted_position: index + 1, confidence: 0.6, win_probability: 0.63, top3_probability: 0.8, win_odds: 2, place_odds: 1.5 }))
  const forecast = { id: 'early', race_id: source.id, model_version: CURRENT_MODEL_VERSIONS[0], predicted_at: '2025-12-31T22:00:00Z', created_at: '2025-12-31T22:01:00Z', podium: allHorses.slice(0, 3), allHorses }
  const pick = { race: { id: source.id, race_datetime: source.start }, horse: { horse_id: 'horse-1' }, predictionId: 'early', winProbability: 0.63, top3Probability: 0.8, observedAt: forecast.created_at, provenance: 'pre-race-recovery' }
  history.maybeSingle.mockResolvedValue({ data: { generated_at: '2026-01-02T00:00:00Z', payload: [{ dateKey: '2026-01-01', picks: [pick, { ...pick, predictionId: 'missing', horse: { horse_id: 'horse-2' } }] }] }, error: null })
  const predictions = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(), retry: vi.fn().mockResolvedValue({ data: [forecast], error: null }) }
  const originalFrom = vi.mocked(db.from).getMockImplementation()!
  vi.mocked(db.from).mockImplementation(table => table === 'predictions' ? predictions as never : originalFrom(table))
  const originalRpc = rpc.getMockImplementation()!
  rpc.mockImplementation(name => name === 'simulation_race_sources' ? { data: null, error: null, abortSignal: () => Promise.resolve({ data: [{ ...source, entries: allHorses.map((horse, index) => ({ horse_id: horse.horse_id, position: index + 1, status: 'finished' })) }], error: null }) } as never : originalRpc(name))
  expect(await refreshSimulationReport(db)).toMatchObject({ skipped: false, rebuilt: 1 })
  expect(predictions.in).toHaveBeenCalledWith('id', ['early', 'missing'])
  const published = JSON.parse(upload.mock.calls[0][1])[0]
  expect(published.historySelections).toHaveLength(1)
  expect(published.historySelections[0]).toMatchObject({ id: 'horse-1', predictionId: 'early', position: 2, winProbability: 0.63, winOdds: 2, winSource: 'racing_com' })
  expect(JSON.parse(upload.mock.calls.at(-1)![1]).historyPickCount).toBe(2)
})

it('preserves the previous report when the retained History snapshot cannot be read', async () => {
  const { db, upload, history } = fixture()
  history.maybeSingle.mockResolvedValue({ data: null, error: { message: 'History unavailable' } })
  await expect(refreshSimulationReport(db)).rejects.toThrow('Reading retained History picks: History unavailable')
  expect(upload).not.toHaveBeenCalled()
})