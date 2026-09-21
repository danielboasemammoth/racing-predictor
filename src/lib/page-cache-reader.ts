import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { createPageSnapshotReader, createPageSnapshotStore } from './page-cache'

const cachedSnapshot = unstable_cache(async (key: string) => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, {
      ...options, cache: 'no-store',
      signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    }) },
  })
  const snapshot = await createPageSnapshotStore(db).read(key)
  if (!snapshot) throw new Error(`Page snapshot unavailable: ${key}`)
  return snapshot
}, ['persisted-page-snapshot-v1'], { revalidate: 60, tags: ['page-snapshots'] })

const reader = createPageSnapshotReader({
  read: async <Value>(key: string) => await cachedSnapshot(key) as { generatedAt: string; data: Value },
  publish: async () => { throw new Error('Read-only page cache') },
})

export async function readPageSnapshot<Value>(key: string) {
  return reader<Value>(key)
}