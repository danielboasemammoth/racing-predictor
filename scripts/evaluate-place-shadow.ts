import { createScriptClient } from './supabase-client'
import { loadPlaceShadowReport } from '../src/lib/paper-betting/place-shadow'

loadPlaceShadowReport(createScriptClient()).then((report) => {
  console.log(JSON.stringify(report, null, 2))
}).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})