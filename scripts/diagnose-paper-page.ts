import { createClient } from '@supabase/supabase-js'
import { queryLatestOpportunities } from '../src/lib/paper-betting/opportunities-query'
import { computeValidationReport } from '../src/lib/paper-betting/validation-query'
import { loadPlaceShadowReport } from '../src/lib/paper-betting/place-shadow'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Public Supabase configuration is required')
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  async function measure(name: string, load: () => Promise<unknown>) {
    const start = performance.now()
    try {
      await load()
      console.log(JSON.stringify({ name, milliseconds: Math.round(performance.now() - start), ok: true }))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
      console.log(JSON.stringify({ name, milliseconds: Math.round(performance.now() - start), ok: false, code }))
      process.exitCode = 1
    }
  }
  let accountId: string | undefined
  await measure('wallet', async () => {
    const account = await db.from('paper_accounts').select('id').eq('name', 'default').maybeSingle()
    if (account.error) throw account.error
    accountId = account.data?.id
    if (!accountId) return
    const bets = await db.from('paper_bets').select('*').eq('account_id', accountId).order('placed_at', { ascending: false }).limit(200)
    if (bets.error) throw bets.error
  })
  await measure('opportunities', () => queryLatestOpportunities(db, { limit: 10 }))
  if (accountId) await measure('validation', () => computeValidationReport(db, accountId!))
  await measure('place-shadow', () => loadPlaceShadowReport(db))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Paper page diagnostic failed')
  process.exitCode = 1
})