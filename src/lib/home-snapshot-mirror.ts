import type { SupabaseClient } from '@supabase/supabase-js'
import type { PageSnapshot } from './page-cache'

export const HOME_MIRROR_PATH = 'pages/v1/home.json'
const MAX_BYTES = 1_900_000

export async function readHomeMirror(fetcher: typeof fetch = fetch): Promise<PageSnapshot<unknown>> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) throw new Error('Snapshot storage URL missing')
  const response = await fetcher(`${base}/storage/v1/object/public/racing-reports/${HOME_MIRROR_PATH}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
  if (!response.ok) throw new Error(`Home mirror unavailable (${response.status})`)
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Home mirror exceeds cache limit')
  const snapshot = JSON.parse(text) as PageSnapshot<{ races?: unknown; tabRaceIds?: unknown; reliabilityByRace?: unknown }>
  if (!Number.isFinite(Date.parse(snapshot.generatedAt)) || Date.parse(snapshot.generatedAt) > Date.now()
    || !Array.isArray(snapshot.data?.races) || !Array.isArray(snapshot.data?.tabRaceIds)
    || !snapshot.data.reliabilityByRace || typeof snapshot.data.reliabilityByRace !== 'object') throw new Error('Invalid home mirror')
  return snapshot
}

export async function publishHomeMirror(db: SupabaseClient, snapshot: PageSnapshot<unknown>) {
  const body = JSON.stringify(snapshot)
  if (Buffer.byteLength(body) > MAX_BYTES) throw new Error('Home mirror exceeds cache limit')
  const { error } = await db.storage.from('racing-reports').upload(HOME_MIRROR_PATH, body, { upsert: true, contentType: 'application/json', cacheControl: '30' })
  if (error) throw error
}