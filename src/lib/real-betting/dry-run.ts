import { evaluateStake, findSensitiveKeys, parseRunnerConfig, type Parsed, type RealBettingRiskLimits, type RealBettingStrategy } from './config'

export const DRY_RUN_DECISIONS = ['BLOCKED_PROVIDER_DISCONNECTED', 'BLOCKED_RISK_LIMIT'] as const
export type DryRunDecision = typeof DRY_RUN_DECISIONS[number]

export interface DryRunAttempt {
  kind: 'DRY_RUN'
  idempotencyKey: string
  configId: string
  runnerVersion: string
  strategy: RealBettingStrategy
  limits: RealBettingRiskLimits
  proposedMarket: 'WIN' | 'PLACE' | null
  proposedStake: number | null
  decision: DryRunDecision
  reason: string
}

const BODY_KEYS = ['kind', 'idempotencyKey', 'runnerVersion', 'config', 'proposal']
const PROPOSAL_KEYS = ['market', 'stake', 'stakedToday', 'openExposure']
const KEY = /^dry-run:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/
const MAX_SLOT_SKEW_MS = 26 * 60 * 60 * 1000

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function slotTime(match: RegExpMatchArray): number {
  const [, , year, month, day, hour, minute] = match
  if (Number(hour) > 23 || Number(minute) > 59 || Number(minute) % 15 !== 0) return NaN
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
  const check = new Date(time)
  return check.getUTCMonth() === Number(month) - 1 && check.getUTCDate() === Number(day) ? time : NaN
}

/**
 * Validates a local runner's dry-run report. The server, not the runner, decides the outcome and
 * it can only ever be a blocked decision: there is no provider connection to place or settle with.
 */
export function parseDryRunAttempt(body: unknown, now: Date): Parsed<DryRunAttempt> {
  const input = record(body)
  if (!input) return { ok: false, errors: ['Body must be a JSON object'] }
  const sensitive = findSensitiveKeys(input)
  if (sensitive.length) return { ok: false, errors: [`Dry-run reports must not contain credentials (${sensitive.join(', ')})`] }
  const errors: string[] = []
  const unknown = Object.keys(input).filter(key => !BODY_KEYS.includes(key))
  if (unknown.length) errors.push(`Unsupported dry-run fields: ${unknown.join(', ')}`)
  if (input.kind !== 'DRY_RUN') errors.push('kind must be DRY_RUN')
  const runnerVersion = typeof input.runnerVersion === 'string' && /^[\w.-]{1,40}$/.test(input.runnerVersion) ? input.runnerVersion : null
  if (!runnerVersion) errors.push('runnerVersion is required')
  const config = parseRunnerConfig(input.config)
  if (!config.ok) errors.push(...config.errors)
  else if (config.value.mode !== 'dry-run') errors.push('Runner config mode must be dry-run to record an attempt')
  const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.match(KEY) : null
  if (!key) errors.push('idempotencyKey must be dry-run:<configId>:<yyyyMMddHHmm UTC>')
  else {
    if (config.ok && key[1] !== config.value.configId) errors.push('idempotencyKey must belong to the runner config')
    const slot = slotTime(key)
    if (!Number.isFinite(slot) || Math.abs(slot - now.getTime()) > MAX_SLOT_SKEW_MS) errors.push('idempotencyKey slot must be a valid time within 26 hours of now')
  }
  let proposal: { market: 'WIN' | 'PLACE'; stake: number; stakedToday: number; openExposure: number } | null = null
  if (input.proposal !== undefined && input.proposal !== null) {
    const raw = record(input.proposal)
    if (!raw || Object.keys(raw).some(field => !PROPOSAL_KEYS.includes(field))) errors.push('proposal may only contain market, stake, stakedToday and openExposure')
    else if ((raw.market !== 'WIN' && raw.market !== 'PLACE') || ![raw.stake, raw.stakedToday, raw.openExposure].every(amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= 9_999_999_999.99 && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6) || (raw.stake as number) <= 0) errors.push('proposal requires WIN or PLACE, a positive whole-cent stake and nonnegative whole-cent exposure amounts')
    else proposal = { market: raw.market, stake: raw.stake as number, stakedToday: raw.stakedToday as number, openExposure: raw.openExposure as number }
  }
  if (errors.length || !config.ok || !key || !runnerVersion) return { ok: false, errors }
  const risk = proposal ? evaluateStake(proposal, config.value.limits) : null
  const blockedByRisk = risk !== null && !risk.allowed
  return { ok: true, value: {
    kind: 'DRY_RUN', idempotencyKey: key[0], configId: config.value.configId, runnerVersion,
    strategy: config.value.strategy, limits: config.value.limits,
    proposedMarket: proposal?.market ?? null, proposedStake: proposal ? Math.round(proposal.stake * 100) / 100 : null,
    decision: blockedByRisk ? 'BLOCKED_RISK_LIMIT' : 'BLOCKED_PROVIDER_DISCONNECTED',
    reason: blockedByRisk ? risk.reason : 'TAB provider is not connected; no order was or can be submitted',
  } }
}
