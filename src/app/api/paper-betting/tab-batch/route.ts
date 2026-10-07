import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readSavedStrategies } from '@/lib/betting/saved-strategies'
import { loadTabBatchPreview } from '@/lib/betting/tab-batch-source'
import { formatTabBatchBet, type TabJurisdiction } from '@/lib/betting/tab-batch'

const headers = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const text = await request.text()
  if (text.length > 32_000) return NextResponse.json({ message: 'Request too large' }, { status: 413, headers })
  let body
  try { body = JSON.parse(text) } catch { return NextResponse.json({ message: 'Invalid JSON' }, { status: 400, headers }) }
  if (!body || !['VIC', 'NSW', 'QLD'].includes(body.jurisdiction)) return NextResponse.json({ message: 'Select a TAB account jurisdiction' }, { status: 400, headers })
  const [strategy] = readSavedStrategies(JSON.stringify([{ schema: 1, name: 'Batch preview', savedAt: new Date().toISOString(), preferences: body.preferences }]))
  if (!strategy) return NextResponse.json({ message: 'Unsupported or incomplete paper-betting configuration' }, { status: 400, headers })
  if (strategy.preferences.settings.method !== 'flat') return NextResponse.json({ message: 'Tote batch export requires flat stakes. Percentage staking needs an actual available balance; Kelly needs a known dividend.' }, { status: 400, headers })
  try { formatTabBatchBet('MR', 1, 1, strategy.preferences.settings.flatStake, 0) } catch (error) {
    return NextResponse.json({ message: (error as Error).message }, { status: 400, headers })
  }
  try {
    const db = await createClient({ signal: AbortSignal.timeout(60_000) })
    const preview = await loadTabBatchPreview(db, strategy.preferences, body.jurisdiction as TabJurisdiction)
    return NextResponse.json(preview, { headers })
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : 'Current source data unavailable; no batch generated' }, { status: 503, headers })
  }
}