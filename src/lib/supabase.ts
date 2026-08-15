import { createClient, SupabaseClient } from '@supabase/supabase-js'

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
  }
  return { url, key }
}

let cachedClient: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!cachedClient) {
    const { url, key } = getEnv()
    cachedClient = createClient(url, key)
  }
  return cachedClient
}

// Convenience alias for backward compatibility
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabase() as any)[prop]
  }
})
