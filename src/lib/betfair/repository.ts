import type { SupabaseClient } from '@supabase/supabase-js'

/** Thin DB access layer for the Betfair Stage 1 tables (supabase/migrate-betfair-stage1.sql). All rows here are separate from paper_bets/paper_accounts (PuntersEdge system) - never mix the two. */

export interface BankrollConfigRow {
  id: string
  actual_betfair_balance: number | null
  allocated_bankroll: number
  reserve_balance: number
  max_automation_pct: number
  bankroll_ceiling: number | null
  withdrawal_threshold: number | null
  topup_threshold: number | null
  simulated_starting_bankroll: number
  simulated_current_bankroll: number
  updated_at: string
}

export interface RiskSettingsRow {
  id: string
  min_confidence: number
  min_edge_pct: number
  min_expected_value: number
  min_odds: number
  max_odds: number
  min_liquidity: number
  max_liquidity_consumption_pct: number
  max_bet: number
  max_pct_bankroll: number
  max_total_exposure_pct: number
  max_daily_stake: number
  max_daily_loss_pct: number
  max_bets_per_day: number
  max_bets_per_race: number
  min_minutes_to_jump: number
  max_minutes_to_jump: number
  permitted_codes: string[]
  permitted_states: string[]
  horse_enabled: boolean
  greyhound_enabled: boolean
  nsw_thoroughbred_auto_enabled: boolean
  staking_method: string
  flat_stake_amount: number
  pct_bankroll_stake: number
  order_transaction_hourly_ceiling: number
  updated_at: string
}

export interface AutomationStateRow {
  id: string
  mode: 'SIMULATION' | 'LIVE_MANUAL' | 'LIVE_AUTO'
  live_betting_enabled: boolean
  daily_loss_stop_triggered_at: string | null
  paused_reason: string | null
  updated_at: string
  updated_by: string | null
}

async function getSingleton<T>(admin: SupabaseClient, table: string): Promise<T> {
  const result = await admin.from(table).select('*').limit(1).single()
  if (result.error) throw new Error(`Failed to load ${table}: ${result.error.message}`)
  return result.data as T
}

export const getBankrollConfig = (admin: SupabaseClient) => getSingleton<BankrollConfigRow>(admin, 'betfair_bankroll_config')
export const getRiskSettings = (admin: SupabaseClient) => getSingleton<RiskSettingsRow>(admin, 'betfair_risk_settings')
export const getAutomationState = (admin: SupabaseClient) => getSingleton<AutomationStateRow>(admin, 'betfair_automation_state')

export async function updateBankrollConfig(admin: SupabaseClient, id: string, patch: Partial<BankrollConfigRow>): Promise<BankrollConfigRow> {
  const result = await admin.from('betfair_bankroll_config').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (result.error) throw new Error(`Failed to update bankroll config: ${result.error.message}`)
  return result.data as BankrollConfigRow
}

export async function updateRiskSettings(admin: SupabaseClient, id: string, patch: Partial<RiskSettingsRow>): Promise<RiskSettingsRow> {
  const result = await admin.from('betfair_risk_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (result.error) throw new Error(`Failed to update risk settings: ${result.error.message}`)
  return result.data as RiskSettingsRow
}

export async function updateAutomationState(admin: SupabaseClient, id: string, patch: Partial<AutomationStateRow>, actor: string): Promise<AutomationStateRow> {
  const result = await admin.from('betfair_automation_state').update({ ...patch, updated_at: new Date().toISOString(), updated_by: actor }).eq('id', id).select('*').single()
  if (result.error) throw new Error(`Failed to update automation state: ${result.error.message}`)
  return result.data as AutomationStateRow
}

export async function writeAuditLog(admin: SupabaseClient, action: string, oldValue: unknown, newValue: unknown, reason: string | null, actor: string) {
  const result = await admin.from('betfair_audit_log').insert({ action, old_value: oldValue, new_value: newValue, reason, actor })
  if (result.error) throw new Error(`Failed to write audit log for ${action}: ${result.error.message}`)
}

export interface SimulatedBetInput {
  marketId: string
  selectionId: string
  runnerName: string
  racingCode: 'horse' | 'greyhound' | 'harness'
  venue: string | null
  raceNumber: number | null
  state: string | null
  jumpTime: string | null
  requestedOdds: number
  minAcceptableOdds: number
  matchedOdds: number | null
  requestedStake: number
  matchedStake: number
  unmatchedStake: number
  status: 'MATCHED' | 'PARTIALLY_MATCHED' | 'UNMATCHED'
  betfairBetId: string
  modelProbability: number
  marketProbability: number | null
  fairOdds: number | null
  stakingMethod: string
  rawEdgePct: number
  commissionAdjustedEdgePct: number | null
  confidence: number
  liquidityAvailable: number
  marketBaseRate: number
  modelVersion: string
  featureVersion: string | null
  bankrollBefore: number
  idempotencyKey: string
  placement: 'MANUAL' | 'AUTOMATIC'
}

export async function placeSimulatedBet(admin: SupabaseClient, input: SimulatedBetInput) {
  const result = await admin
    .from('betfair_bets')
    .insert({
      market_id: input.marketId,
      selection_id: input.selectionId,
      runner_name: input.runnerName,
      racing_code: input.racingCode,
      venue: input.venue,
      race_number: input.raceNumber,
      state: input.state,
      jump_time: input.jumpTime,
      side: 'BACK',
      bet_mode: 'SIMULATION',
      placement: input.placement,
      model_probability: input.modelProbability,
      market_probability: input.marketProbability,
      fair_odds: input.fairOdds,
      requested_odds: input.requestedOdds,
      min_acceptable_odds: input.minAcceptableOdds,
      matched_odds: input.matchedOdds,
      requested_stake: input.requestedStake,
      matched_stake: input.matchedStake,
      unmatched_stake: input.unmatchedStake,
      staking_method: input.stakingMethod,
      raw_edge_pct: input.rawEdgePct,
      commission_adjusted_edge_pct: input.commissionAdjustedEdgePct,
      confidence: input.confidence,
      liquidity_available: input.liquidityAvailable,
      status: input.status,
      betfair_bet_id: input.betfairBetId,
      market_base_rate: input.marketBaseRate,
      model_version: input.modelVersion,
      feature_version: input.featureVersion,
      bankroll_before: input.bankrollBefore,
      idempotency_key: input.idempotencyKey,
    })
    .select('id')
    .single()
  if (result.error) {
    if (result.error.code === '23505') return { placed: false, betId: null as string | null }
    throw new Error(`Failed to place simulated bet: ${result.error.message}`)
  }
  return { placed: true, betId: result.data.id as string }
}

export async function listRecentBets(admin: SupabaseClient, limit = 200) {
  const result = await admin.from('betfair_bets').select('*').order('placed_at', { ascending: false }).limit(limit)
  if (result.error) throw new Error(`Failed to list betfair_bets: ${result.error.message}`)
  return result.data
}

export async function getTodayAccountState(admin: SupabaseClient) {
  const startOfDayMelbourne = new Date()
  startOfDayMelbourne.setUTCHours(0, 0, 0, 0)
  const bets = await admin.from('betfair_bets').select('matched_stake, net_profit, race_number, market_id').eq('bet_mode', 'SIMULATION').gte('placed_at', startOfDayMelbourne.toISOString())
  if (bets.error) throw new Error(`Failed to compute today's account state: ${bets.error.message}`)
  const rows = bets.data ?? []
  const dailyStakeSoFar = rows.reduce((sum, b) => sum + (b.matched_stake ?? 0), 0)
  const dailyRealizedLoss = rows.reduce((sum, b) => sum + Math.min(0, b.net_profit ?? 0), 0) * -1
  return { dailyStakeSoFar, dailyRealizedLoss, betsPlacedToday: rows.length }
}
