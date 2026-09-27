import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshSimulationReport } from '@/lib/betting/refresh-simulation-report'

export const maxDuration = 300

export async function POST() {
  if (!await hasAdminSession()) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  try {
    const result = await refreshSimulationReport(createAdminClient())
    return NextResponse.json({ success: true, message: result.skipped ? result.reason : 'Published historical simulator report', ...result })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'PGRST202' || code === '42883') return NextResponse.json({ success: true, skipped: true, message: 'Simulator refresh skipped: apply the historical simulator migration first.' })
    return NextResponse.json({ success: false, message: 'Simulator refresh failed; previous report retained. Check database health and the simulator migration.' }, { status: 503 })
  }
}