import { describe, expect, it } from 'vitest'
import {
  buildRunnerConfig, canonicalJson, DEFAULT_RISK_LIMITS, evaluateStake, loopbackOrigin, parseRiskLimits, parseRunnerConfig, parseStrategy,
} from './config'
import { configId, runnerConfig as config, strategy } from './test-fixtures'

describe('strategy contract', () => {
  it('accepts the interchange contract and ignores extra fields', () => {
    const parsed = parseStrategy({ ...strategy, id: 'extra' })
    expect(parsed).toEqual({ ok: true, value: strategy })
  })

  it('rejects preferences that the simulator parser would silently repair', () => {
    const bad = structuredClone(strategy) as unknown as { preferences: { filters: { WIN: { minEdge: number } } } }
    bad.preferences.filters.WIN.minEdge = 7
    expect(parseStrategy(bad).ok).toBe(false)
    expect(parseStrategy({ ...strategy, preferences: undefined }).ok).toBe(false)
    expect(parseStrategy({ ...strategy, schema: 2 }).ok).toBe(false)
    expect(parseStrategy({ ...strategy, name: ' ' }).ok).toBe(false)
  })

  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }))
  })
})

describe('risk limits', () => {
  it('has conservative valid defaults', () => {
    expect(parseRiskLimits(DEFAULT_RISK_LIMITS)).toEqual({ ok: true, value: DEFAULT_RISK_LIMITS })
  })

  it('rejects missing, non-positive, fractional-cent, oversized and inconsistent limits', () => {
    for (const limits of [
      {}, { ...DEFAULT_RISK_LIMITS, currency: 'USD' }, { ...DEFAULT_RISK_LIMITS, maxStake: 0 }, { ...DEFAULT_RISK_LIMITS, maxStake: 1.005 },
      { ...DEFAULT_RISK_LIMITS, maxDailyStake: 10_000 }, { ...DEFAULT_RISK_LIMITS, maxStake: 30, maxDailyStake: 20 },
      { ...DEFAULT_RISK_LIMITS, maxOpenExposure: 2 }, { ...DEFAULT_RISK_LIMITS, maxStake: Number.NaN },
    ]) expect(parseRiskLimits(limits).ok).toBe(false)
  })

  it('evaluates per-bet, daily and exposure caps in cents', () => {
    expect(evaluateStake({ stake: 5, stakedToday: 15, openExposure: 15 }, DEFAULT_RISK_LIMITS).allowed).toBe(true)
    expect(evaluateStake({ stake: 4.9, stakedToday: 15.1, openExposure: 0 }, DEFAULT_RISK_LIMITS).allowed).toBe(true)
    expect(evaluateStake({ stake: 5.01, stakedToday: 0, openExposure: 0 }, DEFAULT_RISK_LIMITS).reason).toMatch('maxStake')
    expect(evaluateStake({ stake: 5, stakedToday: 15.01, openExposure: 0 }, DEFAULT_RISK_LIMITS).reason).toMatch('maxDailyStake')
    expect(evaluateStake({ stake: 5, stakedToday: 0, openExposure: 15.01 }, DEFAULT_RISK_LIMITS).reason).toMatch('maxOpenExposure')
    expect(evaluateStake({ stake: -1, stakedToday: 0, openExposure: 0 }, DEFAULT_RISK_LIMITS).allowed).toBe(false)
    expect(evaluateStake({ stake: 1, stakedToday: Number.NaN, openExposure: 0 }, DEFAULT_RISK_LIMITS).allowed).toBe(false)
  })
})

describe('runner config', () => {
  it('exports disabled TAB configs that round-trip', () => {
    const exported = config()
    expect(exported).toMatchObject({ schema: 1, provider: 'tab', mode: 'disabled', enabled: false, appUrl: 'http://localhost:3000' })
    expect(parseRunnerConfig(exported)).toEqual({ ok: true, value: exported })
    expect(parseRunnerConfig({ ...exported, mode: 'dry-run' }).ok).toBe(true)
  })

  it('exported strategy is a copy, not a live reference', () => {
    const source = structuredClone(strategy)
    const exported = buildRunnerConfig(source, DEFAULT_RISK_LIMITS, configId, new Date())
    source.preferences.filters.WIN.minEdge = 20
    expect(exported.strategy.preferences.filters.WIN.minEdge).toBe(strategy.preferences.filters.WIN.minEdge)
  })

  it('refuses any live mode or enabled flag', () => {
    for (const mode of ['live', 'LIVE', 'production', '', undefined]) expect(parseRunnerConfig({ ...config(), mode }).ok).toBe(false)
    for (const enabled of [true, 'false', 0, undefined]) expect(parseRunnerConfig({ ...config(), enabled }).ok).toBe(false)
    expect(parseRunnerConfig({ ...config(), provider: 'betfair' }).ok).toBe(false)
  })

  it('refuses credentials and unknown fields anywhere', () => {
    expect(parseRunnerConfig({ ...config(), password: 'x' })).toEqual({ ok: false, errors: [expect.stringContaining('credentials')] })
    expect(parseRunnerConfig({ ...config(), strategy: { ...strategy, apiKey: 'x' } }).ok).toBe(false)
    expect(parseRunnerConfig({ ...config(), limits: { ...DEFAULT_RISK_LIMITS, token: 'x' } }).ok).toBe(false)
    expect(parseRunnerConfig({ ...config(), endpoint: 'https://example.com' }).ok).toBe(false)
  })

  it('only allows loopback app origins', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:3001', 'https://localhost:3000/']) expect(loopbackOrigin(url)).not.toBeNull()
    for (const url of ['https://racing-predictor-topaz.vercel.app', 'http://[::1]:3000', 'http://localhost.evil.com', 'http://10.0.0.2:3000', 'http://user:pw@localhost:3000', 'http://localhost:3000/api', 'file:///c:/x', 'ftp://localhost'])
      expect(loopbackOrigin(url)).toBeNull()
    expect(parseRunnerConfig({ ...config(), appUrl: 'https://api.beta.tab.com.au' }).ok).toBe(false)
  })
})
