import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { ingestRacingCom } from '../src/lib/scrapers/racing-com'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

function melbourneDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function main() {
  const daysBack = Number(process.argv[2] ?? '14')
  console.log(`Backfilling the last ${daysBack} days across all states to populate the new sectional/pace/stewards columns...`)
  const summary = await ingestRacingCom(supabase, melbourneDate(), { daysBack, daysForward: 0 })
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error('Backfill failed:', error)
  process.exit(1)
})
