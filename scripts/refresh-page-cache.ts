import { createScriptClient } from './supabase-client'
import { PAGE_CACHE_KEYS, refreshPageCache, type PageCacheKey } from '../src/lib/refresh-page-cache'

async function main() {
  const args = process.argv.slice(2)
  if (args.some(key => !PAGE_CACHE_KEYS.includes(key as PageCacheKey))) throw new Error(`Allowed keys: ${PAGE_CACHE_KEYS.join(', ')}`)
  const db = createScriptClient()
  for (const key of args.length ? args as PageCacheKey[] : PAGE_CACHE_KEYS) {
    console.log(JSON.stringify({ key, state: 'refreshing' }))
    const [result] = await refreshPageCache(db, [key])
    console.log(JSON.stringify(result))
    if (!result.ok) process.exitCode = 1
  }
}

main().catch(() => { console.error('Page cache refresh failed'); process.exitCode = 1 })