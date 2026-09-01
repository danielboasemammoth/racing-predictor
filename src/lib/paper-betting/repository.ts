import type { SupabaseClient } from '@supabase/supabase-js'
import type { PeNextToGoRace } from '@/lib/puntersedge/types'
import type { RunnerRecommendation } from '@/lib/paper-betting/generate-recommendations'
import type { RecommendationThresholds } from '@/lib/betting/recommendation-engine'
import type { BetResult } from '@/lib/betting/paper-wallet'

/** Thin DB access layer for the paper-betting/value-engine tables (supabase/migrate-paper-betting.sql). */

export async function upsertRaceAndRunners(admin: SupabaseClient, race: PeNextToGoRace, status: 'upcoming' | 'started' | 'final' = 'upcoming') {
  const { error: raceError } = await admin.from('pe_races').upsert(
    {
      id: race.race_id,
      category: race.category,
      venue: race.venue,
      race_number: race.race_number,
      race_name: race.race_name ?? null,
      start_time: race.start_time,
      country: race.country,
      distance_m: race.distance_m ?? null,
      track_condition: race.track_condition ?? null,
      status,
      last_raw_payload: race,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (raceError) throw new Error(`Failed to upsert pe_race ${race.race_id}: ${raceError.message}`)

  const scratchedNumbers = new Set(race.scratchings.map((s) => s.number))
  const runnerRows = race.runners.map((runner) => ({
    race_id: race.race_id,
    runner_number: runner.number,
    name: runner.name,
    barrier: runner.barrier ?? null,
    jockey: runner.jockey ?? null,
    trainer: runner.trainer ?? null,
    form: runner.form ?? null,
    scratched: scratchedNumbers.has(runner.number),
    updated_at: new Date().toISOString(),
  }))
  if (runnerRows.length === 0) return new Map<number, string>()

  const { data, error: runnerError } = await admin
    .from('pe_runners')
    .upsert(runnerRows, { onConflict: 'race_id,runner_number' })
    .select('id, runner_number')
  if (runnerError) throw new Error(`Failed to upsert pe_runners for race ${race.race_id}: ${runnerError.message}`)

  return new Map<number, string>((data ?? []).map((row) => [row.runner_number as number, row.id as string]))
}

export async function insertOddsSnapshots(
  admin: SupabaseClient,
  raceId: string,
  recommendations: RunnerRecommendation[],
  runnerIdByNumber: Map<number, string>,
  minutesToJump: number,
) {
  const rows = recommendations
    .filter((rec) => runnerIdByNumber.has(rec.runnerNumber))
    .map((rec) => ({
      race_id: raceId,
      runner_id: runnerIdByNumber.get(rec.runnerNumber)!,
      tab_win_price: rec.tabWinPrice,
      tab_place_price: rec.tabPlacePrice,
      tab_age_seconds: rec.tabAgeSeconds,
      best_price: rec.bestPrice,
      median_price: rec.medianPrice,
      num_bookmakers: rec.numBookmakers,
      minutes_to_jump: minutesToJump,
    }))
  if (rows.length === 0) return
  const { error } = await admin.from('pe_odds_snapshots').insert(rows)
  if (error) throw new Error(`Failed to insert odds snapshots for race ${raceId}: ${error.message}`)
}

export async function insertRecommendations(
  admin: SupabaseClient,
  raceId: string,
  category: PeNextToGoRace['category'],
  modelVersion: string,
  thresholds: RecommendationThresholds,
  recommendations: RunnerRecommendation[],
  runnerIdByNumber: Map<number, string>,
  minutesToJump: number,
) {
  const rows = recommendations
    .filter((rec) => runnerIdByNumber.has(rec.runnerNumber))
    .map((rec) => ({
      race_id: raceId,
      runner_id: runnerIdByNumber.get(rec.runnerNumber)!,
      model_version: modelVersion,
      category,
      model_probability: rec.modelProbability,
      tab_win_price: rec.tabWinPrice,
      tab_place_price: rec.tabPlacePrice,
      tab_age_seconds: rec.tabAgeSeconds,
      edge_points: rec.edgePoints,
      expected_value: rec.expectedValueRatio,
      confidence_level: rec.confidenceLevel,
      decision: rec.decision,
      minutes_to_jump: minutesToJump,
      feature_completeness: rec.featureCompleteness,
      reasons: rec.reasons,
      failed_criteria: rec.failedCriteria,
      thresholds,
    }))
  if (rows.length === 0) return
  const { error } = await admin.from('pe_recommendations').insert(rows)
  if (error) throw new Error(`Failed to insert recommendations for race ${raceId}: ${error.message}`)
}

export interface PaperAccountRow {
  id: string
  name: string
  starting_bankroll: number
  current_bankroll: number
  staking_method: string
}

export async function getOrCreateAccount(admin: SupabaseClient, name: string, startingBankroll: number): Promise<PaperAccountRow> {
  const existing = await admin.from('paper_accounts').select('*').eq('name', name).maybeSingle()
  if (existing.error) throw new Error(`Failed to look up paper account ${name}: ${existing.error.message}`)
  if (existing.data) return existing.data as PaperAccountRow

  const created = await admin
    .from('paper_accounts')
    .insert({ name, starting_bankroll: startingBankroll, current_bankroll: startingBankroll })
    .select('*')
    .single()
  if (created.error) throw new Error(`Failed to create paper account ${name}: ${created.error.message}`)
  return created.data as PaperAccountRow
}

export interface PlaceBetInput {
  accountId: string
  raceId: string
  runnerId: string
  runnerName: string
  category: 'horse' | 'greyhound' | 'harness'
  mode: 'AUTO' | 'MANUAL'
  betType: 'WIN' | 'PLACE'
  stake: number
  tabDecimalOdds: number
  modelProbability: number
  modelVersion: string
  edgePoints: number | null
  expectedValue: number | null
  confidenceLevel: string | null
  recommendationId?: string | null
  minutesToJumpAtPlacement: number
  idempotencyKey: string
}

export type PlaceBetResult = { placed: true; betId: string } | { placed: false; reason: 'duplicate' }

/** Insert-only; a unique idempotency_key means a duplicate click is a no-op, not a duplicate bet. */
export async function placeBet(admin: SupabaseClient, input: PlaceBetInput): Promise<PlaceBetResult> {
  const { data, error } = await admin
    .from('paper_bets')
    .insert({
      account_id: input.accountId,
      race_id: input.raceId,
      runner_id: input.runnerId,
      runner_name: input.runnerName,
      category: input.category,
      mode: input.mode,
      bet_type: input.betType,
      stake: input.stake,
      tab_decimal_odds: input.tabDecimalOdds,
      model_probability: input.modelProbability,
      model_version: input.modelVersion,
      edge_points: input.edgePoints,
      expected_value: input.expectedValue,
      confidence_level: input.confidenceLevel,
      recommendation_id: input.recommendationId ?? null,
      minutes_to_jump_at_placement: input.minutesToJumpAtPlacement,
      idempotency_key: input.idempotencyKey,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { placed: false, reason: 'duplicate' } // unique_violation on idempotency_key
    throw new Error(`Failed to place paper bet: ${error.message}`)
  }
  return { placed: true, betId: data.id as string }
}

export async function settleBetInDb(
  admin: SupabaseClient,
  betId: string,
  status: Exclude<BetResult, 'PENDING'>,
  returnAmount: number,
  profit: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc('settle_paper_bet', {
    p_bet_id: betId,
    p_status: status,
    p_return_amount: returnAmount,
    p_profit: profit,
  })
  if (error) throw new Error(`Failed to settle paper bet ${betId}: ${error.message}`)
  return Boolean(data)
}

export async function recordApiUsage(admin: SupabaseClient, usage: { credits_used: number; credits_remaining: number; period_start: string; next_reset_at: string }) {
  const { error } = await admin.from('pe_api_usage').insert({
    credits_used: usage.credits_used,
    credits_remaining: usage.credits_remaining,
    period_start: usage.period_start,
    next_reset_at: usage.next_reset_at,
    raw: usage,
  })
  if (error) throw new Error(`Failed to record API usage: ${error.message}`)
}

export interface PendingBetRow {
  id: string
  stake: number
  tab_decimal_odds: number
  bet_type: 'WIN' | 'PLACE'
  runner_number: number
}

/** Pending WIN/PLACE bets for a race, joined to the runner's number for result matching (never by name). */
export async function getPendingBetsForRace(admin: SupabaseClient, raceId: string): Promise<PendingBetRow[]> {
  const { data, error } = await admin
    .from('paper_bets')
    .select('id, stake, tab_decimal_odds, bet_type, pe_runners!inner(runner_number)')
    .eq('race_id', raceId)
    .eq('status', 'PENDING')
  if (error) throw new Error(`Failed to load pending bets for race ${raceId}: ${error.message}`)
  return (data ?? []).map((row) => {
    const runner = Array.isArray(row.pe_runners) ? row.pe_runners[0] : row.pe_runners
    return {
      id: row.id as string,
      stake: row.stake as number,
      tab_decimal_odds: row.tab_decimal_odds as number,
      bet_type: row.bet_type as 'WIN' | 'PLACE',
      runner_number: (runner as { runner_number: number }).runner_number,
    }
  })
}

