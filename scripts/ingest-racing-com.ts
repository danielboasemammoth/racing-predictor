import { createClient } from '@supabase/supabase-js'
import { ingestRacingCom } from '../src/lib/scrapers/racing-com'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase environment variables are not configured')

  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const summary = await ingestRacingCom(supabase, date)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Ingestion failed')
  process.exitCode = 1
})