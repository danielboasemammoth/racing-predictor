import type { SupabaseClient } from '@supabase/supabase-js'

/** Shared "latest recommendation per runner, upcoming races only" query used by the opportunities
 * API route, the /greyhounds page, and the /paper-betting best-opportunities section. */
export interface OpportunityRow {
  id: string
  race_id: string
  runner_id: string
  model_probability: number | null
  tab_win_price: number | null
  tab_place_price: number | null
  edge_points: number | null
  expected_value: number | null
  confidence_level: string | null
  decision: 'BET' | 'WATCH' | 'NO_BET'
  generated_at: string
  category: string
  pe_runners: { name: string; runner_number: number } | { name: string; runner_number: number }[] | null
  pe_races: { venue: string; race_number: number; category: string; start_time: string } | { venue: string; race_number: number; category: string; start_time: string }[] | null
}

export async function queryLatestOpportunities(
  supabase: SupabaseClient,
  options: { category?: string; raceIds?: string[]; limit?: number } = {},
): Promise<OpportunityRow[]> {
  const recentCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  let query = supabase
    .from('pe_recommendations')
    .select(
      'id, race_id, runner_id, model_probability, tab_win_price, tab_place_price, edge_points, expected_value, confidence_level, decision, generated_at, category, pe_runners(name, runner_number), pe_races!inner(venue, race_number, category, start_time, status)',
    )
    .in('decision', ['BET', 'WATCH'])
    .gte('generated_at', recentCutoff)
    .eq('pe_races.status', 'upcoming')
    .order('generated_at', { ascending: false })
    .limit(options.limit ?? 500)

  if (options.category) query = query.eq('category', options.category)
  if (options.raceIds) query = query.in('race_id', options.raceIds)

  const { data, error } = await query
  if (error) throw error

  const seenRunnerIds = new Set<string>()
  const latestPerRunner = ((data ?? []) as OpportunityRow[]).filter((row) => {
    if (seenRunnerIds.has(row.runner_id)) return false
    seenRunnerIds.add(row.runner_id)
    return true
  })

  latestPerRunner.sort((a, b) => {
    if (a.decision !== b.decision) return a.decision === 'BET' ? -1 : 1
    return (b.edge_points ?? 0) - (a.edge_points ?? 0)
  })

  return latestPerRunner
}
