import { beforeEach, expect, it, vi } from 'vitest'
import { GET, POST, DELETE } from './route'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { readSimulationPreferences } from '@/lib/betting/simulation-preferences'

vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
beforeEach(() => vi.resetAllMocks())
const request = (body: unknown) => new Request('http://localhost/api/betting-strategies', { method: 'POST', body: JSON.stringify(body) })

it('rejects unauthenticated writes before accessing the database', async () => {
  vi.mocked(hasAdminSession).mockResolvedValue(false)
  expect((await POST(request({}))).status).toBe(401)
  expect((await DELETE(request({ name: 'One' }))).status).toBe(401)
  expect(createAdminClient).not.toHaveBeenCalled()
})

it('validates settings and saves a named snapshot through the admin client', async () => {
  vi.mocked(hasAdminSession).mockResolvedValue(true)
  expect((await POST(request({ name: 'One', preferences: { schema: 1 } }))).status).toBe(400)
  const upsert = vi.fn().mockResolvedValue({ error: null })
  vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => ({ upsert })) } as never)
  const preferences = readSimulationPreferences(null)
  expect((await POST(request({ name: ' One ', preferences }))).status).toBe(200)
  expect(upsert).toHaveBeenCalledWith({ name: 'One', preferences, saved_at: expect.any(String) }, { onConflict: 'name' })
})

it('loads shared strategies without requiring admin and never caches the response', async () => {
  vi.mocked(hasAdminSession).mockResolvedValue(false)
  const preferences = readSimulationPreferences(null)
  const limit = vi.fn().mockResolvedValue({ data: [{ name: 'One', preferences, saved_at: '2026-10-07T00:00:00Z' }], error: null })
  vi.mocked(createClient).mockResolvedValue({ from: () => ({ select: () => ({ order: () => ({ limit }) }) }) } as never)
  const response = await GET()
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ canEdit: false, strategies: [{ schema: 1, name: 'One', preferences, savedAt: '2026-10-07T00:00:00Z' }] })
})

it('reports database failure rather than claiming a save succeeded', async () => {
  vi.mocked(hasAdminSession).mockResolvedValue(true)
  vi.mocked(createAdminClient).mockReturnValue({ from: () => ({ upsert: async () => ({ error: { code: '42P01' } }) }) } as never)
  expect((await POST(request({ name: 'One', preferences: readSimulationPreferences(null) }))).status).toBe(503)
})