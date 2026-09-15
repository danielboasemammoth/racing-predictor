import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { autoPlaceReliabilityBets } from '@/lib/paper-betting/reliability-auto-bet'

export async function POST() {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const summary = await autoPlaceReliabilityBets(supabase)
    const rejected = Object.entries(summary.rejectionCounts).filter(([, count]) => count > 0).map(([reason, count]) => `${reason}=${count}`).join(', ')
    return NextResponse.json({
      success: true,
      message: `${summary.policyVersion}: evaluated ${summary.marketsConsidered} runner/markets, placed ${summary.winBetsPlaced} WIN and ${summary.placeBetsPlaced} PLACE (${summary.skippedDuplicate} duplicates, ${summary.skippedZeroStake} zero stake). Rejections: ${rejected || 'none'}. Race skips: ${JSON.stringify(summary.raceSkips)}. Shadow: ${summary.shadowRacesRecorded} new races, ${summary.shadowCaptureErrors} capture errors.${summary.policyTrackingAvailable ? '' : ' Policy migration missing: new bets remain untagged.'}`,
      ...summary,
    })
  } catch (error) {
    console.error('Reliability auto-bet failed', error)
    return NextResponse.json({ success: false, message: 'Reliability auto-bet failed' }, { status: 500 })
  }
}
