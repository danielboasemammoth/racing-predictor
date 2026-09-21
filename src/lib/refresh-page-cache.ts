import type { SupabaseClient } from '@supabase/supabase-js'
import { createPageSnapshotStore, refreshPageSnapshot } from './page-cache'
import { pageLoaders } from './page-snapshot-loaders'

export type PageCacheKey = keyof typeof pageLoaders
export const PAGE_CACHE_KEYS = Object.keys(pageLoaders) as PageCacheKey[]

export async function refreshPageCache(db: SupabaseClient, keys: readonly PageCacheKey[] = PAGE_CACHE_KEYS) {
  const store = createPageSnapshotStore(db)
  const results: Array<{ key: PageCacheKey; ok: boolean; milliseconds: number; code?: string }> = []
  for (const key of keys) {
    const start = performance.now()
    try {
      await refreshPageSnapshot(store, key, () => pageLoaders[key](db) as Promise<unknown>)
      results.push({ key, ok: true, milliseconds: Math.round(performance.now() - start) })
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
      console.error('Page snapshot refresh failed', { key, code })
      results.push({ key, ok: false, code, milliseconds: Math.round(performance.now() - start) })
    }
  }
  return results
}