import { describe, expect, it } from 'vitest'
import { parseDryRunAttempt } from './dry-run'
import { configId, runnerConfig, strategy } from './test-fixtures'

const now = new Date('2026-10-01T02:00:00Z')
const body = (overrides: Record<string, unknown> = {}) => ({
  kind: 'DRY_RUN', idempotencyKey: `dry-run:${configId}:202610010200`, runnerVersion: '1', config: runnerConfig({ mode: 'dry-run' }), ...overrides,
})

describe('dry-run attempts', () => {
  it('records only a blocked provider-disconnected decision', () => {
    const parsed = parseDryRunAttempt(body(), now)
    expect(parsed).toEqual({ ok: true, value: expect.objectContaining({
      kind: 'DRY_RUN', configId, strategy, proposedMarket: null, proposedStake: null, decision: 'BLOCKED_PROVIDER_DISCONNECTED',
    }) })
  })

  it('server applies risk limits to proposals', () => {
    const within = parseDryRunAttempt(body({ proposal: { market: 'PLACE', stake: 5, stakedToday: 0, openExposure: 0 } }), now)
    expect(within.ok && within.value.decision).toBe('BLOCKED_PROVIDER_DISCONNECTED')
    const over = parseDryRunAttempt(body({ proposal: { market: 'WIN', stake: 50, stakedToday: 0, openExposure: 0 } }), now)
    expect(over.ok && over.value).toMatchObject({ decision: 'BLOCKED_RISK_LIMIT', proposedStake: 50 })
  })

  it('rejects anything resembling a live order, outcome or settlement', () => {
    for (const extra of [{ kind: 'LIVE' }, { status: 'WON' }, { outcome: 'WON' }, { providerOrderId: 'abc' }, { returnAmount: 10 }, { decision: 'PLACED' }])
      expect(parseDryRunAttempt(body(extra), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ proposal: { market: 'WIN', stake: 1, stakedToday: 0, openExposure: 0, outcome: 'WON' } }), now).ok).toBe(false)
  })

  it('requires a dry-run config without credentials', () => {
    expect(parseDryRunAttempt(body({ config: runnerConfig() }), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ config: { ...runnerConfig({ mode: 'dry-run' }), enabled: true } }), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ password: 'x' }), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ config: { ...runnerConfig({ mode: 'dry-run' }), credentials: {} } }), now).ok).toBe(false)
  })

  it.each([-1, 0, 0.001, Infinity, 10_000_000_000])('rejects an unrecordable stake of %s before persistence', stake => {
    expect(parseDryRunAttempt(body({ proposal: { market: 'WIN', stake, stakedToday: 0, openExposure: 0 } }), now).ok).toBe(false)
  })

  it('binds idempotency keys to the config and a recent valid slot', () => {
    expect(parseDryRunAttempt(body({ idempotencyKey: 'dry-run:00000000-0000-4000-8000-000000000000:202610010200' }), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ idempotencyKey: `dry-run:${configId}:202609280200` }), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ idempotencyKey: `dry-run:${configId}:202602300200` }), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ idempotencyKey: `dry-run:${configId}:202610010201` }), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ idempotencyKey: `dry-run:${configId}:202610010260` }), now).ok).toBe(false)
    expect(parseDryRunAttempt(body({ idempotencyKey: `live:${configId}:202610010200` }), now).ok).toBe(false)
    const first = parseDryRunAttempt(body(), now)
    const repeat = parseDryRunAttempt(body(), new Date(now.getTime() + 60_000))
    expect(first.ok && repeat.ok && first.value.idempotencyKey === repeat.value.idempotencyKey).toBe(true)
  })
})
