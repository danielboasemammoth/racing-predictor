import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { autoPlaceReliabilityBets } from '@/lib/paper-betting/reliability-auto-bet'

/**
 * Auto-places WIN paper bets for today's + tomorrow's Reliability Score shortlist picks (see
 * reliability-auto-bet.ts) - the internal-model counterpart to the PuntersEdge sync route's
 * auto-betting. Run this after Refresh Reliability Calibration so it reads fresh calibration data.
 */
export async function POST() {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const summary = await autoPlaceReliabilityBets(supabase)
    return NextResponse.json({
      success: true,
      message: `Considered ${summary.candidatesConsidered} qualifying pick${summary.candidatesConsidered === 1 ? '' : 's'}, placed ${summary.betsPlaced} bet${summary.betsPlaced === 1 ? '' : 's'} (${summary.skippedDuplicate} already placed, ${summary.skippedNoOdds} missing odds, ${summary.skippedZeroStake} zero stake)`,
      ...summary,
    })
  } catch (error) {
    console.error('Reliability auto-bet failed', error)
    return NextResponse.json({ success: false, message: 'Reliability auto-bet failed' }, { status: 500 })
  }
}
