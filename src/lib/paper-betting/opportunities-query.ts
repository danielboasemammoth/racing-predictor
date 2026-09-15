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
  place_model_probability: number | null
  place_edge_points: number | null
  place_expected_value: number | null
  place_decision: 'BET' | 'WATCH' | 'NO_BET' | null
  generated_at: string
  category: string
  pe_runners: { name: string; runner_number: number } | { name: string; runner_number: number }[] | null
  pe_races: { venue: string; race_number: number; category: string; start_time: string } | { venue: string; race_number: number; category: string; start_time: string }[] | null
}

export async function queryLatestOpportunities(
  supabase: SupabaseClient,
  options: { category?: string; raceIds?: string[]; limit?: number } = {},
): Promise<OpportunityRow[]> {
  if (options.raceIds?.length === 0 || options.limit === 0) return []
  const now = new Date()
  const recentCutoff = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
  let racesQuery = supabase.from('pe_races').select('id').eq('status', 'upcoming')
    .gt('start_time', now.toISOString()).order('id')
  if (options.category) racesQuery = racesQuery.eq('category', options.category)
  const requestedIds = options.raceIds ? new Set(options.raceIds) : null
  const raceIds: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const page = await racesQuery.range(offset, offset + 999)
    if (page.error) throw page.error
    const rows = (page.data ?? []) as Array<{ id: string }>
    raceIds.push(...rows.filter((row) => !requestedIds || requestedIds.has(row.id)).map((row) => row.id))
    if (rows.length < 1000) break
  }

  const data: OpportunityRow[] = []
  async function loadRaceBatch(ids: string[]) {
    const batchRows: OpportunityRow[] = []
    let query = supabase.from('pe_recommendations')
      .select('id, race_id, runner_id, model_probability, tab_win_price, tab_place_price, edge_points, expected_value, confidence_level, decision, place_model_probability, place_edge_points, place_expected_value, place_decision, generated_at, category, pe_runners(name, runner_number), pe_races(venue, race_number, category, start_time, status)')
      .in('race_id', ids)
      .gte('generated_at', recentCutoff)
      .order('generated_at', { ascending: false }).order('id', { ascending: false })
    if (options.category) query = query.eq('category', options.category)
    for (let offset = 0; ; offset += 1000) {
      const page = await query.range(offset, offset + 999)
      if (page.error) throw page.error
      const rows = (page.data ?? []) as OpportunityRow[]
      batchRows.push(...rows)
      if (rows.length < 1000) break
    }
    return batchRows
  }
  for (let batch = 0; batch < raceIds.length; batch += 80) {
    const pending: Array<Promise<OpportunityRow[]>> = []
    for (let offset = batch; offset < Math.min(batch + 80, raceIds.length); offset += 20) {
      pending.push(loadRaceBatch(raceIds.slice(offset, offset + 20)))
    }
    for (const rows of await Promise.all(pending)) data.push(...rows)
  }

  const seenRunnerIds = new Set<string>()
  const latestPerRunner = data.filter((row) => {
    if (seenRunnerIds.has(row.runner_id)) return false
    seenRunnerIds.add(row.runner_id)
    return true
  }).filter((row) => opportunityMarkets(row).length > 0)

  latestPerRunner.sort((a, b) => {
    const left = opportunityMarkets(a)[0]
    const right = opportunityMarkets(b)[0]
    if (left.decision !== right.decision) return left.decision === 'BET' ? -1 : 1
    return (right.probability ?? 0) - (left.probability ?? 0)
  })

  return latestPerRunner.slice(0, options.limit ?? 500)
}

export function opportunityMarkets(row: OpportunityRow) {
  return [
    { betType: 'WIN', decision: row.decision, price: row.tab_win_price, probability: row.model_probability, edge: row.edge_points, ev: row.expected_value },
    { betType: 'PLACE', decision: row.place_decision, price: row.tab_place_price, probability: row.place_model_probability, edge: row.place_edge_points, ev: row.place_expected_value },
  ].filter((market) => (market.decision === 'BET' || market.decision === 'WATCH')
    && market.price != null && Number.isFinite(market.price) && market.price > 1)
    .sort((left, right) => {
      if (left.decision !== right.decision) return left.decision === 'BET' ? -1 : 1
      return (right.probability ?? 0) - (left.probability ?? 0)
    })
}
