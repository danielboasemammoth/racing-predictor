import 'dotenv/config'
import { config } from 'dotenv'
import { ingestRacingCom } from '../src/lib/scrapers/racing-com'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Melbourne',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date())

ingestRacingCom(createScriptClient(), today, { daysBack: 7, daysForward: 0 })
  .then((summary) => console.log(JSON.stringify(summary, null, 2)))
  .catch((error: unknown) => {
    console.error('Victoria results backfill failed', error)
    process.exitCode = 1
  })
