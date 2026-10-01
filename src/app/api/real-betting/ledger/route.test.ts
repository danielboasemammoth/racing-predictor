import { beforeEach, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }))
vi.mock('@/lib/real-betting/ledger', () => ({ loadRealBettingLedger: mocks.load }))
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(true) })

it('hides ledger history from unauthenticated callers', async () => {
  mocks.auth.mockResolvedValue(false)
  const response = await GET()
  expect(response.status).toBe(401)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(mocks.load).not.toHaveBeenCalled()
})

it('returns ledger state with the provider marked disconnected', async () => {
  mocks.load.mockResolvedValueOnce({ status: 'migration-pending' })
  expect(await (await GET()).json()).toEqual({ success: true, provider: { name: 'tab', connected: false }, ledger: { status: 'migration-pending' } })
  mocks.load.mockResolvedValueOnce({ status: 'unavailable', message: 'x' })
  expect((await GET()).status).toBe(503)
})
