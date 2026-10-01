import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseDryRunAttempt } from './dry-run'
import { loadRealBettingLedger, recordDryRunAttempt, strategyHash } from './ledger'
import { configId, runnerConfig, strategy } from './test-fixtures'

const now = new Date('2026-10-01T02:00:00Z')
const parsed = parseDryRunAttempt({ kind: 'DRY_RUN', idempotencyKey: `dry-run:${configId}:202610010200`, runnerVersion: '1', config: runnerConfig({ mode: 'dry-run' }) }, now)
if (!parsed.ok) throw new Error('fixture invalid')
const attempt = parsed.value

function client(result: { data: unknown; error: unknown }) {
  const query = { upsert: vi.fn().mockReturnThis(), select: vi.fn(async () => result) }
  return { admin: { from: vi.fn(() => query) } as unknown as SupabaseClient, query }
}

it('hashes strategies independent of key order', () => {
  expect(strategyHash(strategy)).toMatch(/^[0-9a-f]{64}$/)
  expect(strategyHash(JSON.parse(JSON.stringify({ preferences: strategy.preferences, savedAt: strategy.savedAt, name: strategy.name, schema: 1 })))).toBe(strategyHash(strategy))
})

it('inserts with ignore-duplicates on the idempotency key and never a placed status', async () => {
  const { admin, query } = client({ data: [{ id: 'x' }], error: null })
  expect(await recordDryRunAttempt(admin, attempt)).toEqual({ status: 'recorded' })
  expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'DRY_RUN', provider: 'tab', decision: 'BLOCKED_PROVIDER_DISCONNECTED' }), { onConflict: 'idempotency_key', ignoreDuplicates: true })
  expect(await recordDryRunAttempt(client({ data: [], error: null }).admin, attempt)).toEqual({ status: 'duplicate' })
})

it('distinguishes a missing migration from other failures', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await recordDryRunAttempt(client({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }).admin, attempt)).toEqual({ status: 'migration-pending' })
  expect((await recordDryRunAttempt(client({ data: null, error: { code: '42501', message: 'permission denied' } }).admin, attempt)).status).toBe('error')
  const reader = { from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn(async () => ({ data: null, error: { code: '42P01' } })) })) }
  expect(await loadRealBettingLedger(reader as unknown as SupabaseClient)).toEqual({ status: 'migration-pending' })
})
