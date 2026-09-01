import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * "Best opportunities now" feed - the latest recommendation per runner for races that haven't
 * jumped yet, ordered BET first (by edge), then WATCH. NO_BET runners are omitted entirely so
 * the feed only ever shows genuinely qualifying or promising opportunities.
 */
export async function GET(request: Request) {
  const admin = createAdminClient()
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')

  const recentCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  let query = admin
    .from('pe_recommendations')
    .select('*, pe_runners(name, runner_number, race_id), pe_races!inner(venue, race_number, category, start_time, status)')
    .in('decision', ['BET', 'WATCH'])
    .gte('generated_at', recentCutoff)
    .eq('pe_races.status', 'upcoming')
    .order('generated_at', { ascending: false })
    .limit(500)
  if (category) query = query.eq('category', category)

  const { data, error } = await query
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })

  // Keep only the latest recommendation per runner (rows are already ordered newest-first).
  const seenRunnerIds = new Set<string>()
  const latestPerRunner = (data ?? []).filter((row) => {
    if (seenRunnerIds.has(row.runner_id as string)) return false
    seenRunnerIds.add(row.runner_id as string)
    return true
  })

  latestPerRunner.sort((a, b) => {
    if (a.decision !== b.decision) return a.decision === 'BET' ? -1 : 1
    return (b.edge_points ?? 0) - (a.edge_points ?? 0)
  })

  return NextResponse.json({ success: true, opportunities: latestPerRunner })
}
