import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalJson, type RealBettingStrategy } from './config'
import type { DryRunAttempt } from './dry-run'

export interface RealBetRow {
  id: string
  provider: string
  provider_order_id: string | null
  strategy_name: string
  race_ref: string
  selection_ref: string
  market: string
  quoted_odds: number
  stake: number
  currency: string
  status: string
  outcome: string | null
  return_amount: number | null
  settlement_verified_at: string | null
  created_at: string
}

export interface DryRunAttemptRow {
  id: string
  strategy_name: string
  strategy_hash: string
  proposed_market: string | null
  proposed_stake: number | null
  decision: string
  reason: string
  runner_version: string
  created_at: string
}

export type RealBettingLedger =
  | { status: 'ready'; bets: RealBetRow[]; attempts: DryRunAttemptRow[] }
  | { status: 'migration-pending' }
  | { status: 'unavailable'; message: string }

const HISTORY_LIMIT = 50

export function strategyHash(strategy: RealBettingStrategy): string {
  return createHash('sha256').update(canonicalJson(strategy)).digest('hex')
}

function missingTable(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST205' || error.code === '42P01' || /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

export async function loadRealBettingLedger(admin: SupabaseClient): Promise<RealBettingLedger> {
  const [bets, attempts] = await Promise.all([
    admin.from('real_bets')
      .select('id, provider, provider_order_id, strategy_name, race_ref, selection_ref, market, quoted_odds, stake, currency, status, outcome, return_amount, settlement_verified_at, created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_LIMIT),
    admin.from('real_betting_attempts')
      .select('id, strategy_name, strategy_hash, proposed_market, proposed_stake, decision, reason, runner_version, created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_LIMIT),
  ])
  const error = bets.error ?? attempts.error
  if (error) {
    if (missingTable(error)) return { status: 'migration-pending' }
    console.error('Real betting ledger unavailable', { code: error.code, message: error.message })
    return { status: 'unavailable', message: 'The real betting ledger could not be read.' }
  }
  return { status: 'ready', bets: (bets.data ?? []) as RealBetRow[], attempts: (attempts.data ?? []) as DryRunAttemptRow[] }
}

export type RecordDryRunResult = { status: 'recorded' | 'duplicate' | 'migration-pending' } | { status: 'error'; message: string }

export async function recordDryRunAttempt(admin: SupabaseClient, attempt: DryRunAttempt): Promise<RecordDryRunResult> {
  const { data, error } = await admin.from('real_betting_attempts').upsert({
    kind: attempt.kind,
    idempotency_key: attempt.idempotencyKey,
    provider: 'tab',
    config_id: attempt.configId,
    runner_version: attempt.runnerVersion,
    strategy_name: attempt.strategy.name,
    strategy_hash: strategyHash(attempt.strategy),
    strategy_snapshot: attempt.strategy,
    risk_limits: attempt.limits,
    proposed_market: attempt.proposedMarket,
    proposed_stake: attempt.proposedStake,
    currency: 'AUD',
    decision: attempt.decision,
    reason: attempt.reason,
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true }).select('id')
  if (error) {
    if (missingTable(error)) return { status: 'migration-pending' }
    console.error('Dry-run attempt not recorded', { code: error.code, message: error.message })
    return { status: 'error', message: 'Dry-run attempt could not be recorded' }
  }
  return { status: (data ?? []).length ? 'recorded' : 'duplicate' }
}
