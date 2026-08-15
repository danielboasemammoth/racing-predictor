import { createClient } from '@supabase/supabase-js'
import { ingestRacingCom, type IngestionSummary } from '../src/lib/scrapers/racing-com'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase environment variables are not configured')

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const today = new Date().toISOString().slice(0, 10)
  const total: IngestionSummary = { meetings: 0, races: 0, horses: 0, entries: 0, skippedMeetings: 0 }

  // Racing.com's userDate variable is ignored, and broad responses are capped.
  // Overlapping lookbacks retrieve each truncated segment and source IDs de-duplicate writes.
  for (const daysBack of [60, 45, 30, 15]) {
    const summary = await ingestRacingCom(supabase, today, {
      daysBack,
      daysForward: 0,
      maxMeetings: 60,
    })
    for (const key of Object.keys(total) as Array<keyof IngestionSummary>) total[key] += summary[key]
    console.log(`${daysBack}-day lookback: ${summary.meetings} meetings, ${summary.races} races`)
  }

  console.log(JSON.stringify(total, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Historical ingestion failed')
  process.exitCode = 1
})