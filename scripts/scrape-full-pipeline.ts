import 'dotenv/config'
import { config } from 'dotenv'
import { ingestRacingCom } from '../src/lib/scrapers/racing-com'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })

async function main() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const supabase = createScriptClient()
  const results = await ingestRacingCom(supabase, today, { daysBack: 7, daysForward: 0, maxMeetings: 60 })
  const upcoming = await ingestRacingCom(supabase, today, { daysBack: 0, daysForward: 3 })
  console.log(JSON.stringify({ results, upcoming }, null, 2))
}

main().catch((error: unknown) => {
  console.error('Full ingestion pipeline failed', error)
  process.exitCode = 1
})
