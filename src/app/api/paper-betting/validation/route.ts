import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeValidationReport } from '@/lib/paper-betting/validation-query'

/**
 * MODEL VALIDATION: profit/ROI/strike-rate over trailing windows, plus expected-vs-actual
 * calibration (Brier score, log loss) across every settled bet - the numbers that answer
 * "should I trust this system with real money yet", not just "does it look profitable".
 */
export async function GET() {
  const admin = createAdminClient()

  const account = await admin.from('paper_accounts').select('id').eq('name', 'default').maybeSingle()
  if (account.error) return NextResponse.json({ success: false, message: account.error.message }, { status: 500 })
  if (!account.data) return NextResponse.json({ success: true, exists: false })

  try {
    const report = await computeValidationReport(admin, account.data.id)
    return NextResponse.json({ success: true, exists: true, ...report })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to compute validation report'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}

