import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseDryRunAttempt } from '@/lib/real-betting/dry-run'
import { recordDryRunAttempt } from '@/lib/real-betting/ledger'

const noStore = { 'Cache-Control': 'no-store' }
const MAX_BODY_CHARS = 32_000

export async function POST(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401, headers: noStore })
  const text = await request.text()
  if (text.length > MAX_BODY_CHARS) return NextResponse.json({ success: false, message: 'Body too large' }, { status: 413, headers: noStore })
  let body: unknown
  try { body = JSON.parse(text) } catch { return NextResponse.json({ success: false, message: 'Invalid JSON' }, { status: 400, headers: noStore }) }
  const attempt = parseDryRunAttempt(body, new Date())
  if (!attempt.ok) return NextResponse.json({ success: false, message: 'Invalid dry-run attempt', errors: attempt.errors }, { status: 400, headers: noStore })
  const result = await recordDryRunAttempt(createAdminClient(), attempt.value)
  if (result.status === 'migration-pending') return NextResponse.json({ success: false, message: 'Real betting migration has not been applied' }, { status: 503, headers: noStore })
  if (result.status === 'error') return NextResponse.json({ success: false, message: result.message }, { status: 503, headers: noStore })
  return NextResponse.json({
    success: true,
    message: result.status === 'duplicate' ? 'Dry-run attempt already recorded' : 'Dry-run attempt recorded; no order submitted',
    duplicate: result.status === 'duplicate',
    decision: attempt.value.decision,
    placed: false,
  }, { headers: noStore })
}
