import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET, POST } from './route'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getTabScheduledRaces } from '@/lib/tab-races'
import { readBonusBackOffers } from '@/lib/betting/bonus-back'

vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/tab-races', () => ({ getTabScheduledRaces: vi.fn() }))
vi.mock('@/lib/betting/bonus-back', async original => ({ ...await original<typeof import('@/lib/betting/bonus-back')>(), readBonusBackOffers: vi.fn() }))

const raceId = '11111111-1111-4111-8111-111111111111'
const runnerId = '22222222-2222-4222-8222-222222222222'
const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(), upsert: vi.fn().mockReturnThis() }
const request = (overrides = {}) => new Request('http://localhost/api/bonus-back', { method: 'POST', body: JSON.stringify({ raceId, runnerId, cap: 50, confirmed: true, ...overrides }) })

beforeEach(() => {
  vi.clearAllMocks()
  query.maybeSingle.mockReset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-11T02:00:00Z'))
  query.select.mockReturnThis()
  vi.mocked(hasAdminSession).mockResolvedValue(true)
  vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => query) } as never)
  vi.mocked(createClient).mockResolvedValue({} as never)
  vi.mocked(getTabScheduledRaces).mockResolvedValue([{ race_datetime: '2026-10-11T03:00:00Z' }] as never)
  query.maybeSingle.mockResolvedValueOnce({ data: { id: raceId }, error: null }).mockResolvedValueOnce({ data: { horse_id: runnerId, status: 'running', horses: { name: 'Runner' } }, error: null })
})
afterEach(() => vi.useRealTimers())

it('requires admin authorization before touching the database', async () => {
  vi.mocked(hasAdminSession).mockResolvedValue(false)
  expect((await POST(request())).status).toBe(401)
  expect(createAdminClient).not.toHaveBeenCalled()
})

it('rejects excessive caps, missing confirmation and invalid IDs', async () => {
  for (const input of [{ cap: 51 }, { cap: -1 }, { cap: '50' }, { cap: 0.001 }, { confirmed: false }, { raceId: 'other' }]) expect((await POST(request(input))).status).toBe(400)
  expect(createAdminClient).not.toHaveBeenCalled()
})

it('rejects races that have already started or are not open on TAB', async () => {
  vi.mocked(getTabScheduledRaces).mockResolvedValue([])
  expect((await POST(request())).status).toBe(409)
  expect(query.upsert).not.toHaveBeenCalled()
})

it('stores server-time eligibility without allowing a later overwrite or client backdating', async () => {
  query.select.mockImplementation((fields: string) => fields === 'kind' ? Promise.resolve({ data: [{ kind: 'offer' }], error: null }) : query)
  const response = await POST(request({ confirmedAt: '2020-01-01T00:00:00Z' }))
  expect(response.status).toBe(201)
  expect((await response.json()).offer).toMatchObject({ raceId, runnerId, cap: 50, confirmedAt: '2026-10-11T02:00:00.000Z', basis: 'manual' })
  expect(query.upsert).toHaveBeenCalledWith(expect.any(Object), { onConflict: 'kind', ignoreDuplicates: true })
})

it('reports duplicate confirmation instead of overwriting it', async () => {
  query.select.mockImplementation((fields: string) => fields === 'kind' ? Promise.resolve({ data: [], error: null }) : query)
  expect((await POST(request())).status).toBe(409)
})

it('serves public confirmations without granting editing and fails closed on outages', async () => {
  vi.mocked(hasAdminSession).mockResolvedValue(false)
  vi.mocked(readBonusBackOffers).mockResolvedValue([])
  expect(await (await GET()).json()).toEqual({ offers: [], canEdit: false })
  vi.mocked(readBonusBackOffers).mockRejectedValue(new Error('unavailable'))
  expect((await GET()).status).toBe(503)
})