import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadRealBettingLedger } from '@/lib/real-betting/ledger'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET() {
  if (!await hasAdminSession()) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401, headers: noStore })
  const ledger = await loadRealBettingLedger(createAdminClient())
  return NextResponse.json({ success: ledger.status !== 'unavailable', provider: { name: 'tab', connected: false }, ledger }, { status: ledger.status === 'unavailable' ? 503 : 200, headers: noStore })
}
