import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshReliabilityCalibration } from '@/lib/reliability-refresh'

/**
 * Republishes the Reliability Score calibration table + comparable-race history
 * (analysis_snapshots: 'reliability-calibration'/'race-feature-history') from every completed
 * race currently in the database. Without this being re-run periodically, the Reliability Score,
 * Segment Explorer, and similar-races comparisons all stay frozen at whatever the dataset looked
 * like the last time this ran - this route lets it be wired into the scheduled daily pipeline
 * (see scripts/windows/run-daily-tasks.ps1) instead of only ever being a manually-run script.
 */
export async function POST() {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const { rows, calibration } = await refreshReliabilityCalibration(supabase)
    if (!rows.length) {
      return NextResponse.json({ success: false, message: 'No analyzable completed races found' }, { status: 404 })
    }
    return NextResponse.json({
      success: true,
      message: `Republished reliability calibration from ${rows.length} races (baseline ${(calibration.overallBaseline * 100).toFixed(1)}%)`,
      racesAnalyzed: rows.length,
    })
  } catch (error) {
    console.error('Reliability refresh failed', error)
    return NextResponse.json({ success: false, message: 'Reliability refresh failed' }, { status: 500 })
  }
}
