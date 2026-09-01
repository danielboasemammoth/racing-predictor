import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { queryLatestOpportunities } from '@/lib/paper-betting/opportunities-query'

/**
 * "Best opportunities now" feed - the latest recommendation per runner for races that haven't
 * jumped yet, ordered BET first (by edge), then WATCH. NO_BET runners are omitted entirely so
 * the feed only ever shows genuinely qualifying or promising opportunities.
 */
export async function GET(request: Request) {
  const admin = createAdminClient()
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') ?? undefined

  try {
    const opportunities = await queryLatestOpportunities(admin, { category })
    return NextResponse.json({ success: true, opportunities })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load opportunities'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}

