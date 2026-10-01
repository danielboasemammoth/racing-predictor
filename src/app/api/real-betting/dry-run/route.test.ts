import { beforeEach, expect, it, vi } from 'vitest'
import { configId, runnerConfig } from '@/lib/real-betting/test-fixtures'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }))
vi.mock('@/lib/real-betting/ledger', () => ({ recordDryRunAttempt: mocks.record }))
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(true); mocks.record.mockResolvedValue({ status: 'recorded' }) })

const slot = () => new Date(Math.floor(Date.now() / 900_000) * 900_000).toISOString().replace(/[-T:]/g, '').slice(0, 12)
const valid = () => ({ kind: 'DRY_RUN', idempotencyKey: `dry-run:${configId}:${slot()}`, runnerVersion: '1', config: runnerConfig({ mode: 'dry-run' }) })
const request = (body: unknown) => new Request('http://localhost/api/real-betting/dry-run', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })

it('rejects unauthenticated writes without touching the database', async () => {
  mocks.auth.mockResolvedValue(false)
  expect((await POST(request(valid()))).status).toBe(401)
  expect(mocks.client).not.toHaveBeenCalled()
  expect(mocks.record).not.toHaveBeenCalled()
})

it('rejects invalid, live or fabricated-outcome payloads', async () => {
  for (const body of ['{', { ...valid(), kind: 'LIVE' }, { ...valid(), outcome: 'WON' }, { ...valid(), config: runnerConfig({ mode: 'disabled' }) }, 'x'.repeat(40_000)])
    expect((await POST(request(body))).status).toBeGreaterThanOrEqual(400)
  expect(mocks.record).not.toHaveBeenCalled()
})

it('records blocked dry runs and reports duplicates as safe no-ops', async () => {
  const first = await POST(request(valid()))
  expect(first.status).toBe(200)
  expect(await first.json()).toMatchObject({ success: true, duplicate: false, placed: false, decision: 'BLOCKED_PROVIDER_DISCONNECTED' })
  mocks.record.mockResolvedValueOnce({ status: 'duplicate' })
  expect(await (await POST(request(valid()))).json()).toMatchObject({ success: true, duplicate: true, placed: false })
})

it('reports a pending migration honestly', async () => {
  mocks.record.mockResolvedValueOnce({ status: 'migration-pending' })
  const response = await POST(request(valid()))
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({ success: false, message: expect.stringContaining('migration') })
})
