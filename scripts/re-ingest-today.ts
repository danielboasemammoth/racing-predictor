import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { ingestRacingCom } from '../src/lib/scrapers/racing-com'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
if (!url || !key) throw new Error('Supabase credentials not configured')

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: 'numeric',
  }).format(new Date())

  console.log('Re-ingesting:', today)
  const summary = await ingestRacingCom(supabase, today, { daysBack: 2, daysForward: 0 })
  console.log('Summary:', JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  console.error('Error:', e)
  process.exit(1)
})
