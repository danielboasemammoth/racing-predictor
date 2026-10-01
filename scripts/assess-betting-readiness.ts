import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { legacyPaperBettingEnabled } from '../src/lib/betting/legacy-betting'
import { DEFAULT_SIMULATION_FILTERS, simulateBets, simulationCandidates, type SimulationMarket } from '../src/lib/betting/historical-simulator'
import { DEFAULT_SIMULATION_SETTINGS } from '../src/lib/betting/simulation-preferences'
import { findProfitSuggestion } from '../src/lib/betting/simulation-optimizer'
import { legacySimulationPreset } from '../src/lib/betting/simulation-presets'
import { readSimulationChunks, readSimulationManifest, simulationReportBaseUrl } from '../src/lib/betting/simulation-report'
import type { SimulationEvidence } from '../src/lib/betting/simulation-evidence'
import { loopbackOrigin } from '../src/lib/real-betting/config'

async function main() {
  const { values } = parseArgs({ options: { 'app-url': { type: 'string' }, since: { type: 'string' }, 'capture-evidence': { type: 'boolean', default: false } } })
  assert.ok(values.since && Number.isFinite(Date.parse(values.since)), 'Provide --since with the cutoff timestamp for new race results')
  const since = Date.parse(values.since)
  const appUrl = loopbackOrigin(values['app-url'])
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const snapshots = async () => {
    const rows: Array<{ kind: string; generated_at: string; payload: SimulationEvidence }> = []
    let cursor = ''
    for (;;) {
      let query = admin.from('analysis_snapshots').select('kind, generated_at, payload').like('kind', 'simulator-evidence-v1:%').order('kind').limit(250)
      if (cursor) query = query.gt('kind', cursor)
      const result = await query
      if (result.error) throw result.error
      if (!result.data.length) break
      rows.push(...result.data as typeof rows)
      cursor = result.data.at(-1)!.kind
    }
    return rows
  }
  const before = await snapshots()
  let capture: unknown = null
  if (values['capture-evidence']) {
    assert.equal(legacyPaperBettingEnabled(), false, 'Evidence collection requires retired legacy betting')
    assert.ok(appUrl, 'Evidence capture requires a loopback --app-url')
    const health = await fetch(`${appUrl}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
    assert.equal((await health.json()).app, 'racing-predictor')
    assert.ok(process.env.ADMIN_API_KEY, 'Local admin authentication is required')
    const cookie = createHmac('sha256', process.env.ADMIN_API_KEY).update('racing-predictor-admin-session').digest('hex')
    const response = await fetch(`${appUrl}/api/admin/reliability-auto-bet`, { method: 'POST', headers: { Cookie: `racing_admin_session=${cookie}` }, redirect: 'error', signal: AbortSignal.timeout(180_000) })
    assert.equal(response.status, 200, 'Evidence observer request failed; do not retry automatically')
    const result = await response.json()
    assert.equal(result.success, true)
    assert.equal(result.betsPlaced, 0)
    assert.equal(result.shadowCaptureErrors, 0)
    capture = { message: result.message, shadowRacesRecorded: result.shadowRacesRecorded, captureErrors: result.shadowCaptureErrors, betsPlaced: result.betsPlaced }
  }
  const after = await snapshots()
  const byKind = new Map(after.map(row => [row.kind, row]))
  for (const row of before) assert.deepEqual(byKind.get(row.kind), row, 'Existing evidence must never be rewritten')
  const predictions = new Map<string, { race_id: string; predicted_at: string; created_at: string; model_version: string }>()
  for (let offset = 0; offset < after.length; offset += 50) {
    const result = await admin.from('predictions').select('id, race_id, predicted_at, created_at, model_version').in('id', after.slice(offset, offset + 50).map(row => row.payload.predictionId))
    if (result.error) throw result.error
    for (const row of result.data) predictions.set(row.id, row)
  }
  const raceIds = [...new Set([...predictions.values()].map(row => row.race_id))]
  const races = new Map<string, { race_datetime: string; status: string }>()
  for (let offset = 0; offset < raceIds.length; offset += 50) {
    const result = await admin.from('races').select('id, race_datetime, status').in('id', raceIds.slice(offset, offset + 50))
    if (result.error) throw result.error
    for (const row of result.data) races.set(row.id, row)
  }
  const evidence = after.map(row => {
    const prediction = predictions.get(row.payload.predictionId)
    const race = prediction && races.get(prediction.race_id)
    const capturedAt = Date.parse(row.payload.capturedAt)
    const minutes = race ? (Date.parse(race.race_datetime) - capturedAt) / 60_000 : NaN
    const valid = !!prediction && !!race && Number.isFinite(row.payload.reliability) && row.payload.reliability >= 0 && row.payload.reliability <= 100
      && typeof row.payload.qualifiedWin === 'boolean' && row.kind === `simulator-evidence-v1:${row.payload.predictionId}`
      && capturedAt === Date.parse(row.generated_at) && capturedAt >= Date.parse(prediction.created_at) && capturedAt >= Date.parse(prediction.predicted_at)
      && minutes >= 1 && minutes <= 180 && !prediction.model_version.includes('retrospective')
    return { predictionId: row.payload.predictionId, raceId: prediction?.race_id, capturedAt: row.payload.capturedAt, valid, qualifiedWin: row.payload.qualifiedWin, completed: race?.status === 'completed' }
  })
  assert.ok(evidence.every(row => row.valid), 'Evidence contains invalid timestamps or missing linked records')
  const base = simulationReportBaseUrl()
  const manifest = await readSimulationManifest(base)
  assert.ok(manifest)
  assert.equal(manifest.pricingVersion, 3)
  const dataset = await readSimulationChunks(base, manifest)
  assert.ok(Date.parse(dataset.generatedAt) >= since, 'Report predates the new-results cutoff')
  const newRaces = dataset.races.filter(race => Date.parse(race.start) >= since)
  const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' })
  const disabled = { ...DEFAULT_SIMULATION_FILTERS, enabled: false }
  const research = []
  for (const market of ['WIN', 'PLACE'] as SimulationMarket[]) {
    const suggestion = await findProfitSuggestion(dataset.races, market, DEFAULT_SIMULATION_SETTINGS)
    const independentNewRaces = suggestion.splitDate ? newRaces.filter(race => dayFormatter.format(new Date(race.start)) >= suggestion.splitDate!) : []
    const filter = suggestion.filter
    const newResult = filter ? simulateBets(simulationCandidates(independentNewRaces), market === 'WIN' ? { WIN: filter, PLACE: disabled } : { WIN: disabled, PLACE: filter }, DEFAULT_SIMULATION_SETTINGS).summaries : []
    const legacy = legacySimulationPreset(market)
    const legacyNewResults = simulateBets(simulationCandidates(newRaces), market === 'WIN' ? { WIN: legacy, PLACE: disabled } : { WIN: disabled, PLACE: legacy }, DEFAULT_SIMULATION_SETTINGS).summaries
    research.push({ market, suggestion, independentNewRaces: independentNewRaces.length, newResults: newResult, legacyNewResults })
  }
  const report = {
    assessedAt: new Date().toISOString(), since: values.since, reportGeneratedAt: dataset.generatedAt,
    publishedRaces: dataset.races.length, publishedChunks: manifest.chunks.length, newCompletedRaces: newRaces.length,
    settings: DEFAULT_SIMULATION_SETTINGS, capture,
    evidence: { before: before.length, after: after.length, added: after.length - before.length, distinctRaces: raceIds.length, qualifiedSnapshots: evidence.filter(row => row.qualifiedWin).length, completedDistinctRaces: new Set(evidence.filter(row => row.completed).map(row => row.raceId)).size, newSinceCutoff: evidence.filter(row => Date.parse(row.capturedAt) >= since).length, earliest: evidence.map(row => row.capturedAt).sort()[0] ?? null, latest: evidence.map(row => row.capturedAt).sort().at(-1) ?? null, allExistingUnchanged: true, allTimestampChecksPassed: true },
    research,
    caveats: ['New-results metrics reuse the older-day training winner, never optimize against new race results.', 'Holdout results influence eligibility; they are not an untouched prospective trading record.', 'Snapshots are per prediction, not independent races. Historical missing evidence is never backfilled.', 'This report freezes research filters for later comparison; it changes no saved settings and enables no trading.'],
  }
  await mkdir('scripts/output', { recursive: true })
  const path = `scripts/output/betting-readiness-${report.assessedAt.replace(/[:.]/g, '-')}.json`
  await writeFile(path, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ path, ...report }, null, 2))
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })