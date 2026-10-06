import type { SimulationDataset, SimulationRace } from './historical-simulator'

export const SIMULATION_REPORT_BUCKET = 'racing-reports'
export const SIMULATION_MANIFEST_PATH = 'simulator/v1/manifest.json'
export const SIMULATION_PRICING_VERSION = 4
export interface SimulationManifest {
  schema: 1
  pricingVersion?: number
  generatedAt: string
  historyGeneratedAt?: string | null
  historyPickCount?: number
  models: string[]
  chunks: string[]
  races: Array<{ id: string; fingerprint: string }>
}

export function simulationReportBaseUrl() {
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!project) throw new Error('Report storage is not configured')
  return `${project}/storage/v1/object/public/${SIMULATION_REPORT_BUCKET}/`
}

export async function readSimulationManifest(baseUrl: string, fetcher: typeof fetch = fetch): Promise<SimulationManifest | null> {
  const response = await fetcher(`${baseUrl}${SIMULATION_MANIFEST_PATH}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  if (response.status === 404 || response.status === 400) return null
  if (!response.ok) throw new Error(`Report unavailable (${response.status})`)
  const manifest = await response.json() as SimulationManifest
  if (manifest.schema !== 1 || !Array.isArray(manifest.chunks) || manifest.chunks.length > 40 || !Array.isArray(manifest.races) || manifest.races.length > 1000 || !Array.isArray(manifest.models)
    || !manifest.chunks.every(path => /^simulator\/v1\/[a-f0-9]{64}\.json$/.test(path))) throw new Error('Invalid simulation manifest')
  return manifest
}

export async function readSimulationChunks(baseUrl: string, manifest: SimulationManifest, fetcher: typeof fetch = fetch): Promise<SimulationDataset> {
  const races: SimulationRace[] = []
  for (let offset = 0; offset < manifest.chunks.length; offset += 3) {
    const batch = await Promise.all(manifest.chunks.slice(offset, offset + 3).map(async path => {
      const response = await fetcher(`${baseUrl}${path}`, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`Report chunk unavailable (${response.status})`)
      const chunk = await response.json() as SimulationRace[]
      if (!Array.isArray(chunk) || chunk.length > 50) throw new Error('Invalid report chunk')
      return chunk
    }))
    races.push(...batch.flat())
  }
  if (races.length !== manifest.races.length || races.some((race, index) => race.id !== manifest.races[index].id)) throw new Error('Incomplete simulation report')
  return { schema: 1, generatedAt: manifest.generatedAt, models: manifest.models, races,
    historyGeneratedAt: manifest.historyGeneratedAt, historyPickCount: manifest.historyPickCount }
}