import type { SupabaseClient } from '@supabase/supabase-js'

export const INTERNAL_VALUE_POLICY_VERSION = 'internal-value-v1'

export async function supportsPolicyTracking(admin: SupabaseClient): Promise<boolean> {
  const result = await admin.from('paper_bets').select('policy_version').limit(0)
  if (!result.error) return true
  if (['42703', 'PGRST204'].includes(result.error.code) && result.error.message.includes('policy_version')) return false
  throw result.error
}