import { beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), refresh: vi.fn(), invalidate: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }))
vi.mock('@/lib/refresh-page-cache', () => ({ PAGE_CACHE_KEYS: ['home'], refreshPageCache: mocks.refresh }))
vi.mock('next/cache', () => ({ revalidateTag: mocks.invalidate }))
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(true) })
const request = (body: unknown) => new Request('http://localhost/api/admin/page-cache', { method: 'POST', body: JSON.stringify(body) })

it('rejects unauthenticated refreshes without touching data', async () => {
  mocks.auth.mockResolvedValue(false)
  expect((await POST(request({ key: 'home' }))).status).toBe(401)
  expect(mocks.client).not.toHaveBeenCalled()
  expect(mocks.refresh).not.toHaveBeenCalled()
})

it('rejects arbitrary snapshot keys', async () => {
  expect((await POST(request({ key: 'private-data' }))).status).toBe(400)
  expect(mocks.refresh).not.toHaveBeenCalled()
})

it('revalidates only successfully published snapshots', async () => {
  mocks.refresh.mockResolvedValueOnce([{ key: 'home', ok: false }]).mockResolvedValueOnce([{ key: 'home', ok: true }])
  expect((await POST(request({ key: 'home' }))).status).toBe(503)
  expect(mocks.invalidate).not.toHaveBeenCalled()
  expect((await POST(request({ key: 'home' }))).status).toBe(200)
  expect(mocks.invalidate).toHaveBeenCalledWith('page-snapshots', 'max')
})