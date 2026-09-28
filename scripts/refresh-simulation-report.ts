import { createScriptClient } from './supabase-client'
import { refreshSimulationReport } from '../src/lib/betting/refresh-simulation-report'

refreshSimulationReport(createScriptClient(), 600_000).then(result => console.log(JSON.stringify(result))).catch((error: unknown) => {
  console.error('Simulation refresh failed; previous published report retained.')
  if (error && typeof error === 'object') {
    console.error({
      code: 'code' in error ? String(error.code) : undefined,
      message: 'message' in error ? String(error.message).slice(0, 500) : 'Unknown error',
    })
  }
  process.exitCode = 1
})