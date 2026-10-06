import { expect, it, vi } from 'vitest'
import { POST } from './route'
import { ingestRacingCom } from '@/lib/scrapers/racing-com'

vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/scrapers/racing-com', () => ({ ingestRacingCom: vi.fn().mockResolvedValue({ races: 1, entries: 8 }) }))

it('uses a short results window only for explicit recent-mode runs', async () => {
  for (const [mode, daysBack] of [['recent', 1], ['all', 7], [undefined, 7]] as const) {
    const response = await POST(new Request('http://localhost/api/admin/scrape-results', { method: 'POST', body: JSON.stringify({ mode }) }))
    expect(response.status).toBe(200)
    expect(ingestRacingCom).toHaveBeenLastCalledWith({}, expect.any(String), { daysBack, daysForward: 0 })
  }
})