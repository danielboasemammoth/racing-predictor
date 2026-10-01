import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CURRENT_MODEL_VERSIONS } from '../prediction-suite'
import { buildSimulationRace, type SimulationSource } from './simulation-source'
import { readSimulationChunks, readSimulationManifest, simulationReportBaseUrl, SIMULATION_MANIFEST_PATH, SIMULATION_REPORT_BUCKET, SIMULATION_PRICING_VERSION, type SimulationManifest } from './simulation-report'
import type { SimulationRace } from './historical-simulator'
import { getTabPricesForInternalRaces } from '../paper-betting/internal-tab-odds'
import { simulationDecisionKey, type SimulationDecision } from './simulation-decision'

export async function refreshSimulationReport(db: SupabaseClient, budgetMs = 200_000) {
  const token = randomUUID()
  const acquired = await db.rpc('acquire_reporting_lease', { job_name: 'historical-simulator', lease_token: token })
  if (acquired.error) throw acquired.error
  if (!acquired.data) return { skipped: true, reason: 'Refresh already running' }
  const deadline = Date.now() + Math.min(budgetMs, 600_000)
  let stage = 'Reading race window'
  try {
    const window = await db.rpc('simulation_race_window').abortSignal(AbortSignal.timeout(30000))
    if (window.error) throw window.error
    const refs = window.data as Array<{ id: string; fingerprint: string }>
    if (!Array.isArray(refs) || refs.length > 1000) throw new Error('Invalid simulation race window')
    stage = 'Loading previous report'
    const previous = await readSimulationManifest(simulationReportBaseUrl())
    const oldData = previous ? await readSimulationChunks(simulationReportBaseUrl(), previous) : null
    const fingerprints = new Map(previous?.races.map(race => [race.id, race.fingerprint]))
    const races = new Map<string, SimulationRace>(oldData?.races.map(race => [race.id, race]))
    const sameModels = JSON.stringify(previous?.models) === JSON.stringify(CURRENT_MODEL_VERSIONS)
    const recentCutoff = Date.now() - 24 * 60 * 60_000
    const changed = refs.filter(race => !sameModels || previous?.pricingVersion !== SIMULATION_PRICING_VERSION || !races.has(race.id) || fingerprints.get(race.id) !== race.fingerprint || Date.parse(races.get(race.id)!.start) >= recentCutoff)
    if (previous && changed.length === 0 && JSON.stringify(previous.races) === JSON.stringify(refs)) return { skipped: true, reason: 'No source changes' }
    for (let offset = 0; offset < changed.length; offset += 10) {
      if (Date.now() > deadline) throw new Error('Simulation refresh deadline exceeded')
      const batch = changed.slice(offset, offset + 10)
      stage = `Reading race sources ${offset + 1}-${offset + batch.length} of ${changed.length}`
      const result = await db.rpc('simulation_race_sources', { race_ids: batch.map(race => race.id), model_versions: CURRENT_MODEL_VERSIONS }).abortSignal(AbortSignal.timeout(30000))
      if (result.error) throw result.error
      const sources = result.data as SimulationSource[]
      if (!Array.isArray(sources) || sources.length !== batch.length || batch.some(ref => !sources.some(source => source.id === ref.id))) throw new Error('Source race changed during refresh; keeping previous report')
      stage = `Reading near-start TAB quotes ${offset + 1}-${offset + batch.length} of ${changed.length}`
      const prices = await getTabPricesForInternalRaces(db, sources.filter(source => source.forecasts.length).map(source => ({ id: source.id, racecourseName: source.venue, raceNumber: source.number, raceDatetime: source.start })), true)
      stage = `Reading frozen TAB decisions ${offset + 1}-${offset + batch.length} of ${changed.length}`
      const decisions = await db.from('analysis_snapshots').select('kind, generated_at, payload')
        .in('kind', sources.flatMap(source => CURRENT_MODEL_VERSIONS.map(model => simulationDecisionKey(source.id, model))))
        .abortSignal(AbortSignal.timeout(30000)).retry(false)
      if (decisions.error) throw decisions.error
      for (const source of sources) {
        const observations = (decisions.data ?? []).filter(row => {
          const payload = row.payload as SimulationDecision
          return payload?.raceId === source.id && payload.forecast && row.kind === simulationDecisionKey(source.id, payload.forecast.model)
            && Date.parse(row.generated_at) === Date.parse(payload.capturedAt)
        }).map(row => row.payload as SimulationDecision)
        races.set(source.id, buildSimulationRace({ ...source, decisions: observations }, prices.get(source.id)))
      }
    }
    const bucket = db.storage.from(SIMULATION_REPORT_BUCKET)
    const ordered = refs.map(ref => races.get(ref.id)!)
    const chunks: string[] = []
    for (let offset = 0; offset < ordered.length; offset += 25) {
      if (Date.now() > deadline) throw new Error('Simulation refresh deadline exceeded')
      const body = JSON.stringify(ordered.slice(offset, offset + 25))
      if (Buffer.byteLength(body) > 1_900_000) throw new Error('Simulation report chunk exceeds size limit')
      const path = `simulator/v1/${createHash('sha256').update(body).digest('hex')}.json`
      if (!previous?.chunks.includes(path)) {
        stage = `Uploading report chunk ${chunks.length + 1}`
        const result = await bucket.upload(path, body, { contentType: 'application/json', cacheControl: '31536000', upsert: true })
        if (result.error) throw result.error
      }
      chunks.push(path)
    }
    if (Date.now() > deadline) throw new Error('Simulation refresh deadline exceeded')
    stage = 'Rechecking race window'
    const latestWindow = await db.rpc('simulation_race_window').abortSignal(AbortSignal.timeout(30000))
    if (latestWindow.error) throw latestWindow.error
    if (JSON.stringify(latestWindow.data) !== JSON.stringify(refs)) throw new Error('Source changed during refresh; previous report retained')
    stage = 'Verifying report lease'
    const lease = await db.from('reporting_job_leases').select('token').eq('name', 'historical-simulator').eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (lease.error || !lease.data || Date.now() > deadline) throw new Error('Simulation lease or deadline expired')
    const manifest: SimulationManifest = { schema: 1, pricingVersion: SIMULATION_PRICING_VERSION, generatedAt: new Date().toISOString(), models: [...CURRENT_MODEL_VERSIONS], chunks, races: refs }
    stage = 'Publishing report manifest'
    const published = await bucket.upload(SIMULATION_MANIFEST_PATH, JSON.stringify(manifest), { contentType: 'application/json', cacheControl: '60', upsert: true })
    if (published.error) throw published.error
    return { skipped: false, races: ordered.length, rebuilt: changed.length, chunks: chunks.length }
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Unknown error'
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    throw Object.assign(new Error(`${stage}: ${message}`), { code })
  } finally {
    const release = await db.from('reporting_job_leases').delete().eq('name', 'historical-simulator').eq('token', token)
    if (release.error) console.error('Simulation lease release failed', { code: release.error.code })
  }
}