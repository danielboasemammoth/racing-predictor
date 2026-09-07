import type { SupabaseClient } from '@supabase/supabase-js'
import type { PeGreyhoundFormRun, PeGreyhoundStatsGroup, PeNextToGoRace } from '@/lib/puntersedge/types'
import type { PuntersEdgeClient } from '@/lib/puntersedge/client'
import type { RunnerRecommendation } from '@/lib/paper-betting/generate-recommendations'
import type { RecommendationThresholds } from '@/lib/betting/recommendation-engine'
import type { BetResult } from '@/lib/betting/paper-wallet'
import type { PredictedHorse, PredictionPayload } from '@/lib/types'
import { findMatchingInternalRace, buildFundamentalsProbabilityMap, type InternalRaceCandidate } from '@/lib/paper-betting/fundamentals-bridge'
import { computeGreyhoundFundamentalsProbabilities, type GreyhoundDogInput } from '@/lib/paper-betting/greyhound-fundamentals'

/** The production ensemble model version (see prediction-suite.ts) - the fundamentals side of the horse blend. */
const HORSE_FUNDAMENTALS_MODEL_VERSION = 'v4.1-ensemble'

/** Thin DB access layer for the paper-betting/value-engine tables (supabase/migrate-paper-betting.sql). */

/**
 * For a horse-category PuntersEdge race, finds the matching internal (Racing.com) race and blends
 * in its latest v4.1-ensemble prediction as a fundamentals win-probability-per-runner-number map.
 * Returns null (safe fallback to market-consensus-only) whenever any step doesn't cleanly resolve -
 * no unique venue+race_number+time match, no stored prediction yet, or no runner names matched.
 */
export async function findHorseFundamentalsMatch(admin: SupabaseClient, race: PeNextToGoRace): Promise<Map<number, number> | null> {
  if (race.category !== 'horse') return null

  const startTime = new Date(race.start_time)
  const windowStart = new Date(startTime.getTime() - 60 * 60_000).toISOString()
  const windowEnd = new Date(startTime.getTime() + 60 * 60_000).toISOString()

  const { data: candidateRows, error: candidateError } = await admin
    .from('races')
    .select('id, race_number, race_datetime, racecourses(name)')
    .gte('race_datetime', windowStart)
    .lte('race_datetime', windowEnd)
  if (candidateError) throw new Error(`Failed to look up candidate internal races: ${candidateError.message}`)

  const candidates: InternalRaceCandidate[] = (candidateRows ?? []).map((row) => {
    const racecourse = Array.isArray(row.racecourses) ? row.racecourses[0] : row.racecourses
    return {
      raceId: row.id as string,
      racecourseName: (racecourse as { name?: string } | null)?.name ?? '',
      raceNumber: row.race_number as number,
      raceDatetime: row.race_datetime as string,
    }
  })

  const match = findMatchingInternalRace(race.venue, race.race_number, race.start_time, candidates)
  if (!match) return null

  const { data: predictionRows, error: predictionError } = await admin
    .from('predictions')
    .select('predictions')
    .eq('race_id', match.raceId)
    .eq('model_version', HORSE_FUNDAMENTALS_MODEL_VERSION)
    .order('predicted_at', { ascending: false })
    .limit(1)
  if (predictionError) throw new Error(`Failed to look up internal prediction for race ${match.raceId}: ${predictionError.message}`)

  const payload = predictionRows?.[0]?.predictions as PredictionPayload | undefined
  const allHorses: PredictedHorse[] | undefined = payload?.all_horses
  if (!allHorses?.length) return null

  const runners = (race.runners ?? [])
    .filter((runner): runner is typeof runner & { number: number } => runner.number != null)
    .map((runner) => ({ number: runner.number, name: runner.name }))
  const fundamentalsProbabilityByRunnerNumber = buildFundamentalsProbabilityMap(runners, allHorses)
  return fundamentalsProbabilityByRunnerNumber.size > 0 ? fundamentalsProbabilityByRunnerNumber : null
}

// --- Greyhound fundamentals (client + cache) ---------------------------------------------------
// Built 2026-09-07, OFF by default (see ENABLE_GREYHOUND_FUNDAMENTALS in the sync route) - form +
// stats cost 3cr each (6cr/dog). A 14-day cache TTL + a hard per-poll new-fetch cap keep this
// within a sustainable slice of the monthly credit budget - see the constants below for the math.

/** How long a cached form/stats entry is considered fresh - a dog's history barely changes between
 * races (typically ~1-2 weeks apart for an active dog), so this doesn't need to be short-lived. */
const GREYHOUND_CACHE_MAX_AGE_HOURS = 24 * 14

interface GreyhoundFundamentalsCacheRow {
  dog_name: string
  dog_id: number | null
  ambiguous: boolean
  form: PeGreyhoundFormRun[] | null
  box_stats: PeGreyhoundStatsGroup[] | null
  fetched_at: string
}

/**
 * Fails soft (logs + returns null) rather than throwing - a missing/broken cache table (e.g. the
 * migration hasn't been run yet) must degrade to "no fundamentals data", never crash the whole
 * batched sync run the way the pe_runners upsert bug did earlier - see repo notes.
 */
async function getCachedGreyhoundFundamentals(admin: SupabaseClient, dogName: string): Promise<GreyhoundFundamentalsCacheRow | null> {
  const { data, error } = await admin
    .from('pe_greyhound_fundamentals_cache')
    .select('dog_name, dog_id, ambiguous, form, box_stats, fetched_at')
    .eq('dog_name', normalizeDogNameKey(dogName))
    .maybeSingle()
  if (error) {
    console.error(`Greyhound fundamentals cache read failed for ${dogName} (degrading to no cache):`, error.message)
    return null
  }
  if (!data) return null
  const ageHours = (Date.now() - new Date(data.fetched_at as string).getTime()) / 3_600_000
  return ageHours <= GREYHOUND_CACHE_MAX_AGE_HOURS ? (data as GreyhoundFundamentalsCacheRow) : null
}

async function upsertGreyhoundFundamentalsCache(
  admin: SupabaseClient,
  dogName: string,
  dogId: number | null,
  ambiguous: boolean,
  form: PeGreyhoundFormRun[] | null,
  boxStats: PeGreyhoundStatsGroup[] | null,
): Promise<void> {
  const { error } = await admin.from('pe_greyhound_fundamentals_cache').upsert({
    dog_name: normalizeDogNameKey(dogName),
    dog_id: dogId,
    ambiguous,
    form,
    box_stats: boxStats,
    fetched_at: new Date().toISOString(),
  })
  if (error) console.error(`Greyhound fundamentals cache write failed for ${dogName} (data will be re-fetched next time):`, error.message)
}

function normalizeDogNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Read-through cache: fetches (and caches) form + box stats for one dog, spending PuntersEdge
 * credits only on a cache miss/stale entry, up to `newFetchBudget.remaining` per sync run.
 * Returns null (never throws) on any PuntersEdge error for a single dog - one dog's API hiccup
 * should degrade to "no fundamentals for this dog", not fail the whole race.
 */
async function getOrFetchGreyhoundDogData(
  admin: SupabaseClient,
  client: Pick<PuntersEdgeClient, 'greyhoundForm' | 'greyhoundStats'>,
  dogName: string,
  newFetchBudget: { remaining: number },
): Promise<{ form: PeGreyhoundFormRun[] | null; boxStats: PeGreyhoundStatsGroup[] | null } | null> {
  const cached = await getCachedGreyhoundFundamentals(admin, dogName)
  if (cached) return { form: cached.ambiguous ? null : cached.form, boxStats: cached.ambiguous ? null : cached.box_stats }

  if (newFetchBudget.remaining <= 0) return null
  newFetchBudget.remaining -= 1

  try {
    const [form, boxStats] = await Promise.all([client.greyhoundForm(dogName), client.greyhoundStats(dogName, ['box'])])
    const ambiguous = form.ambiguous || boxStats.ambiguous
    await upsertGreyhoundFundamentalsCache(admin, dogName, form.dog_id ?? null, ambiguous, ambiguous ? null : form.runs, ambiguous ? null : boxStats.groups)
    return ambiguous ? null : { form: form.runs, boxStats: boxStats.groups }
  } catch {
    // Best-effort - cache nothing so the next poll retries this dog rather than assuming failure forever.
    return null
  }
}

/**
 * For a greyhound-category race, builds a fundamentals win-probability-per-runner-number map from
 * cached/freshly-fetched form + box stats (see computeGreyhoundFundamentalsProbabilities). Returns
 * null (safe fallback to market-consensus-only) when no runner has any usable data.
 */
export async function findGreyhoundFundamentalsMatch(
  admin: SupabaseClient,
  client: Pick<PuntersEdgeClient, 'greyhoundForm' | 'greyhoundStats'>,
  race: PeNextToGoRace,
  newFetchBudget: { remaining: number },
): Promise<Map<number, number> | null> {
  if (race.category !== 'greyhound') return null

  const runners = (race.runners ?? []).filter((runner): runner is typeof runner & { number: number } => runner.number != null)
  if (runners.length === 0) return null

  const dogs: GreyhoundDogInput[] = []
  for (const runner of runners) {
    const data = await getOrFetchGreyhoundDogData(admin, client, runner.name, newFetchBudget)
    dogs.push({
      runnerNumber: runner.number,
      form: data?.form ?? null,
      boxStatsGroups: data?.boxStats ?? null,
      currentBox: runner.barrier ?? null,
    })
  }

  const probabilities = computeGreyhoundFundamentalsProbabilities(dogs)
  return probabilities.size > 0 ? probabilities : null
}

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

  const scratchedNumbers = new Set((race.scratchings ?? []).map((s) => s.number))
  // Runners with an unresolved program number (verified live - see generate-recommendations.ts)
  // can't be tracked without a stable number, so they're excluded rather than violating the
  // NOT NULL runner_number constraint.
  const runnerRows = (race.runners ?? [])
    .filter((runner) => runner.number != null)
    .map((runner) => ({
      race_id: race.race_id,
      runner_number: runner.number,
      name: runner.name,
      barrier: runner.barrier ?? null,
      jockey: runner.jockey ?? null,
      trainer: runner.trainer ?? null,
      form: runner.form ?? null,
      scratched: scratchedNumbers.has(runner.number as number),
      updated_at: new Date().toISOString(),
    }))
  if (runnerRows.length === 0) return new Map<number, string>()

  // Upstream occasionally sends two runner entries for the same number within one race (verified
  // live) - a single upsert batch containing a duplicate (race_id, runner_number) conflict target
  // crashes with Postgres's "ON CONFLICT DO UPDATE command cannot affect row a second time" rather
  // than picking a winner. Last occurrence wins (most likely the more complete/recent entry).
  const dedupedRunnerRows = [...new Map(runnerRows.map((row) => [row.runner_number, row])).values()]

  const { data, error: runnerError } = await admin
    .from('pe_runners')
    .upsert(dedupedRunnerRows, { onConflict: 'race_id,runner_number' })
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
      field_size: rec.fieldSize,
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
      place_model_probability: rec.place?.modelProbability ?? null,
      place_edge_points: rec.place?.edgePoints ?? null,
      place_expected_value: rec.place?.expectedValueRatio ?? null,
      place_decision: rec.place?.decision ?? null,
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

export async function getOrCreateAccount(admin: SupabaseClient, name: string, startingBankroll: number, stakingMethod?: string): Promise<PaperAccountRow> {
  const existing = await admin.from('paper_accounts').select('*').eq('name', name).maybeSingle()
  if (existing.error) throw new Error(`Failed to look up paper account ${name}: ${existing.error.message}`)
  if (existing.data) return existing.data as PaperAccountRow

  const created = await admin
    .from('paper_accounts')
    .insert({ name, starting_bankroll: startingBankroll, current_bankroll: startingBankroll, ...(stakingMethod ? { staking_method: stakingMethod } : {}) })
    .select('*')
    .single()
  if (created.error) throw new Error(`Failed to create paper account ${name}: ${created.error.message}`)
  return created.data as PaperAccountRow
}

/**
 * Rebases the account's starting bankroll (spec: user chooses their starting budget). Preserves
 * accumulated net profit/loss rather than wiping it: current_bankroll becomes
 * newStartingBankroll + (old current_bankroll - old starting_bankroll). Never rewrites individual
 * bets' own recorded bankroll_after - those remain an honest historical record of the old basis.
 * `stakingMethod`, when passed, is applied alongside the rebase (it only ever affects future bets).
 */
export async function updateStartingBankroll(admin: SupabaseClient, accountId: string, newStartingBankroll: number, stakingMethod?: string): Promise<PaperAccountRow> {
  const existing = await admin.from('paper_accounts').select('*').eq('id', accountId).single()
  if (existing.error) throw new Error(`Failed to load paper account ${accountId}: ${existing.error.message}`)
  const netProfit = (existing.data.current_bankroll as number) - (existing.data.starting_bankroll as number)

  const updated = await admin
    .from('paper_accounts')
    .update({
      starting_bankroll: newStartingBankroll,
      current_bankroll: newStartingBankroll + netProfit,
      updated_at: new Date().toISOString(),
      ...(stakingMethod ? { staking_method: stakingMethod } : {}),
    })
    .eq('id', accountId)
    .select('*')
    .single()
  if (updated.error) throw new Error(`Failed to update starting bankroll for account ${accountId}: ${updated.error.message}`)
  return updated.data as PaperAccountRow
}

/** Deletes all bets for an account and resets it to a fresh bankroll - destructive, admin-confirmed only. */
export async function resetAccount(admin: SupabaseClient, accountId: string, newStartingBankroll: number, stakingMethod?: string): Promise<PaperAccountRow> {
  const betIds = await admin.from('paper_bets').select('id').eq('account_id', accountId)
  if (betIds.error) throw new Error(`Failed to list bets for account ${accountId}: ${betIds.error.message}`)
  const ids = (betIds.data ?? []).map((row) => row.id as string)

  // pe_settlement_audit references paper_bets without ON DELETE CASCADE on some databases
  // (fixed in migrate-paper-betting-cascade-settlement-audit.sql) - clear it explicitly first
  // so the bet delete below doesn't fail with a foreign key violation.
  if (ids.length > 0) {
    const deleteAudit = await admin.from('pe_settlement_audit').delete().in('paper_bet_id', ids)
    if (deleteAudit.error) throw new Error(`Failed to clear settlement audit for account ${accountId}: ${deleteAudit.error.message}`)
  }

  const deleteBets = await admin.from('paper_bets').delete().eq('account_id', accountId)
  if (deleteBets.error) throw new Error(`Failed to clear bets for account ${accountId}: ${deleteBets.error.message}`)

  const updated = await admin
    .from('paper_accounts')
    .update({
      starting_bankroll: newStartingBankroll,
      current_bankroll: newStartingBankroll,
      updated_at: new Date().toISOString(),
      ...(stakingMethod ? { staking_method: stakingMethod } : {}),
    })
    .eq('id', accountId)
    .select('*')
    .single()
  if (updated.error) throw new Error(`Failed to reset account ${accountId}: ${updated.error.message}`)
  return updated.data as PaperAccountRow
}

/**
 * Deletes not-yet-settled auto-placed bets so the next PuntersEdge sync recreates them with
 * up-to-date stakes (e.g. after the user changes the staking method or starting budget) -
 * settled bets are left untouched since they're honest history, not a live recommendation.
 */
export async function deletePendingAutoBets(admin: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await admin
    .from('paper_bets')
    .delete()
    .eq('account_id', accountId)
    .eq('mode', 'AUTO')
    .eq('status', 'PENDING')
    .select('id')
  if (error) throw new Error(`Failed to clear pending auto bets for account ${accountId}: ${error.message}`)
  return (data ?? []).length
}

export interface PlaceBetInput {
  accountId: string
  raceId: string
  runnerId: string
  runnerName: string
  category: 'horse' | 'greyhound' | 'harness'
  /** 'puntersedge' (default elsewhere in this file) or 'internal' - the home page's own Racing.com-sourced prediction models. */
  source: 'puntersedge' | 'internal'
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
      source: input.source,
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

/**
 * Whether calling PuntersEdge results() could plausibly settle anything right now - a PENDING bet
 * whose race jumped at least `bufferMinutes` ago (results land a median 4.9min after the jump).
 * Used to skip the results API call entirely (2 credits/call) on ticks with nothing to settle,
 * which was previously the majority of scheduled polls. Only PuntersEdge-sourced bets are settled
 * here (internal-source bets have no pe_races row) - paper_bets.race_id no longer has a DB-level
 * FK to pe_races (see migrate-paper-betting-internal-source.sql), so this can't rely on a PostgREST
 * embed/inner-join filter anymore - it's a manual two-step lookup instead.
 */
export async function hasSettleableBets(admin: SupabaseClient, bufferMinutes = 10): Promise<boolean> {
  const pending = await admin.from('paper_bets').select('race_id').eq('status', 'PENDING').eq('source', 'puntersedge')
  if (pending.error) throw new Error(`Failed to check for settleable bets: ${pending.error.message}`)
  const raceIds = [...new Set((pending.data ?? []).map((b) => b.race_id as string))]
  if (raceIds.length === 0) return false

  const cutoff = new Date(Date.now() - bufferMinutes * 60_000).toISOString()
  const races = await admin.from('pe_races').select('id').in('id', raceIds).lte('start_time', cutoff).limit(1)
  if (races.error) throw new Error(`Failed to check for settleable bets: ${races.error.message}`)
  return (races.data ?? []).length > 0
}

/** Latest recorded PuntersEdge credit usage, or null if none has been recorded yet. */
export async function getLatestApiUsage(admin: SupabaseClient): Promise<{ creditsRemaining: number } | null> {
  const { data, error } = await admin.from('pe_api_usage').select('credits_remaining').order('checked_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`Failed to load latest API usage: ${error.message}`)
  return data ? { creditsRemaining: data.credits_remaining as number } : null
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
  const bets = await admin
    .from('paper_bets')
    .select('id, stake, tab_decimal_odds, bet_type, runner_id')
    .eq('race_id', raceId)
    .eq('status', 'PENDING')
    .eq('source', 'puntersedge')
  if (bets.error) throw new Error(`Failed to load pending bets for race ${raceId}: ${bets.error.message}`)
  const rows = bets.data ?? []
  if (rows.length === 0) return []

  // paper_bets.runner_id no longer has a DB-level FK to pe_runners either - resolve separately.
  const runnerIds = [...new Set(rows.map((b) => b.runner_id as string))]
  const runners = await admin.from('pe_runners').select('id, runner_number').in('id', runnerIds)
  if (runners.error) throw new Error(`Failed to load runners for race ${raceId}: ${runners.error.message}`)
  const runnerNumberById = new Map((runners.data ?? []).map((r) => [r.id as string, r.runner_number as number]))

  return rows
    .map((row) => ({
      id: row.id as string,
      stake: row.stake as number,
      tab_decimal_odds: row.tab_decimal_odds as number,
      bet_type: row.bet_type as 'WIN' | 'PLACE',
      runner_number: runnerNumberById.get(row.runner_id as string),
    }))
    .filter((row): row is PendingBetRow => row.runner_number != null)
}

