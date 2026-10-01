import { readSimulationPreferences, type SimulationPreferences } from '@/lib/betting/simulation-preferences'

export const REAL_BETTING_SCHEMA = 1
export const REAL_BETTING_PROVIDER = 'tab'
export const RUNNER_MODES = ['disabled', 'dry-run'] as const
export type RunnerMode = typeof RUNNER_MODES[number]
export const DEFAULT_RUNNER_APP_URL = 'http://localhost:3000'

export interface RealBettingRiskLimits {
  currency: 'AUD'
  maxStake: number
  maxDailyStake: number
  maxOpenExposure: number
}

export const DEFAULT_RISK_LIMITS: RealBettingRiskLimits = { currency: 'AUD', maxStake: 5, maxDailyStake: 20, maxOpenExposure: 20 }
export const RISK_LIMIT_CEILINGS = { maxStake: 50, maxDailyStake: 200, maxOpenExposure: 200 } as const

export interface RealBettingStrategy {
  schema: 1
  name: string
  savedAt: string
  preferences: SimulationPreferences
}

export interface RealBettingRunnerConfig {
  schema: 1
  provider: 'tab'
  mode: RunnerMode
  enabled: false
  configId: string
  exportedAt: string
  appUrl: string
  strategy: RealBettingStrategy
  limits: RealBettingRiskLimits
}

export type Parsed<Value> = { ok: true; value: Value } | { ok: false, errors: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SENSITIVE_KEY = /password|passwd|secret|token|api[_-]?key|credential|cookie|session|^pin$|^auth/i
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])
const CONFIG_KEYS = ['schema', 'provider', 'mode', 'enabled', 'configId', 'exportedAt', 'appUrl', 'strategy', 'limits']

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = record(value)
  if (object) return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function findSensitiveKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findSensitiveKeys(item, `${path}[${index}]`))
  const object = record(value)
  if (!object) return []
  return Object.entries(object).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key
    return [...(SENSITIVE_KEY.test(key) ? [childPath] : []), ...findSensitiveKeys(child, childPath)]
  })
}

export function loopbackOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) return null
  if (url.pathname !== '/' || url.search || url.hash) return null
  return url.origin
}

/** Strictly validates the shared strategy interchange contract; never silently repairs preferences. */
export function parseStrategy(value: unknown): Parsed<RealBettingStrategy> {
  const strategy = record(value)
  if (!strategy) return { ok: false, errors: ['Strategy must be a JSON object'] }
  const errors: string[] = []
  if (strategy.schema !== 1) errors.push('Strategy schema must be 1')
  const name = typeof strategy.name === 'string' ? strategy.name.trim() : ''
  if (!name || name.length > 120) errors.push('Strategy name must be 1-120 characters')
  if (!isIsoTimestamp(strategy.savedAt)) errors.push('Strategy savedAt must be an ISO timestamp')
  const preferences = readSimulationPreferences(JSON.stringify(strategy.preferences ?? null))
  if (canonicalJson(preferences) !== canonicalJson(strategy.preferences)) errors.push('Strategy preferences contain missing or unsupported simulator values')
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { schema: 1, name, savedAt: new Date(strategy.savedAt as string).toISOString(), preferences } }
}

function centsAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && Math.abs(Math.round(value * 100) - value * 100) < 1e-6
}

export function parseRiskLimits(value: unknown): Parsed<RealBettingRiskLimits> {
  const limits = record(value)
  if (!limits) return { ok: false, errors: ['Risk limits must be a JSON object'] }
  const errors: string[] = []
  if (limits.currency !== 'AUD') errors.push('Currency must be AUD')
  for (const key of ['maxStake', 'maxDailyStake', 'maxOpenExposure'] as const) {
    const amount = limits[key]
    if (!centsAmount(amount)) errors.push(`${key} must be a positive amount in whole cents`)
    else if (amount > RISK_LIMIT_CEILINGS[key]) errors.push(`${key} cannot exceed ${RISK_LIMIT_CEILINGS[key]}`)
  }
  if (errors.length) return { ok: false, errors }
  const parsed = { currency: 'AUD' as const, maxStake: limits.maxStake as number, maxDailyStake: limits.maxDailyStake as number, maxOpenExposure: limits.maxOpenExposure as number }
  if (parsed.maxStake > parsed.maxDailyStake) errors.push('maxStake cannot exceed maxDailyStake')
  if (parsed.maxStake > parsed.maxOpenExposure) errors.push('maxStake cannot exceed maxOpenExposure')
  return errors.length ? { ok: false, errors } : { ok: true, value: parsed }
}

export function parseRunnerConfig(value: unknown): Parsed<RealBettingRunnerConfig> {
  const config = record(value)
  if (!config) return { ok: false, errors: ['Runner config must be a JSON object'] }
  const sensitive = findSensitiveKeys(config)
  if (sensitive.length) return { ok: false, errors: [`Runner config must not contain credentials (${sensitive.join(', ')})`] }
  const errors: string[] = []
  const unknown = Object.keys(config).filter(key => !CONFIG_KEYS.includes(key))
  if (unknown.length) errors.push(`Unsupported runner config fields: ${unknown.join(', ')}`)
  if (config.schema !== 1) errors.push('Runner config schema must be 1')
  if (config.provider !== REAL_BETTING_PROVIDER) errors.push('Provider must be tab')
  if (!RUNNER_MODES.includes(config.mode as RunnerMode)) errors.push('Mode must be disabled or dry-run; live placement is not available')
  if (config.enabled !== false) errors.push('enabled must be false; live placement is not available')
  if (typeof config.configId !== 'string' || !UUID.test(config.configId)) errors.push('configId must be a lowercase UUID')
  if (!isIsoTimestamp(config.exportedAt)) errors.push('exportedAt must be an ISO timestamp')
  const appUrl = loopbackOrigin(config.appUrl)
  if (!appUrl) errors.push('appUrl must be a loopback origin such as http://localhost:3000')
  const strategy = parseStrategy(config.strategy)
  if (!strategy.ok) errors.push(...strategy.errors)
  const limits = parseRiskLimits(config.limits)
  if (!limits.ok) errors.push(...limits.errors)
  if (errors.length || !strategy.ok || !limits.ok || !appUrl) return { ok: false, errors }
  return { ok: true, value: {
    schema: 1, provider: 'tab', mode: config.mode as RunnerMode, enabled: false, configId: config.configId as string,
    exportedAt: new Date(config.exportedAt as string).toISOString(), appUrl, strategy: strategy.value, limits: limits.value,
  } }
}

/** Exports are always disabled; switching to dry-run is a deliberate local edit. */
export function buildRunnerConfig(strategy: RealBettingStrategy, limits: RealBettingRiskLimits, configId: string, now: Date): RealBettingRunnerConfig {
  return {
    schema: 1, provider: 'tab', mode: 'disabled', enabled: false, configId, exportedAt: now.toISOString(),
    appUrl: DEFAULT_RUNNER_APP_URL, strategy: structuredClone(strategy), limits: { ...limits },
  }
}

export interface StakeExposure { stake: number; stakedToday: number; openExposure: number }

export function evaluateStake(proposal: StakeExposure, limits: RealBettingRiskLimits): { allowed: boolean; reason: string } {
  const amounts = [proposal.stake, proposal.stakedToday, proposal.openExposure]
  if (!amounts.every(amount => Number.isFinite(amount) && amount >= 0) || proposal.stake <= 0) return { allowed: false, reason: 'Invalid stake or exposure amounts' }
  const cents = (amount: number) => Math.round(amount * 100)
  const stake = cents(proposal.stake)
  if (stake > cents(limits.maxStake)) return { allowed: false, reason: `Stake exceeds maxStake ${limits.maxStake}` }
  if (cents(proposal.stakedToday) + stake > cents(limits.maxDailyStake)) return { allowed: false, reason: `Stake would exceed maxDailyStake ${limits.maxDailyStake}` }
  if (cents(proposal.openExposure) + stake > cents(limits.maxOpenExposure)) return { allowed: false, reason: `Stake would exceed maxOpenExposure ${limits.maxOpenExposure}` }
  return { allowed: true, reason: 'Within configured risk limits' }
}
