import { beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { loadTabBatchPreview } from '@/lib/betting/tab-batch-source'
import { picksHistoryPreset } from '@/lib/betting/simulation-presets'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/betting/tab-batch-source', () => ({ loadTabBatchPreview: vi.fn() }))
beforeEach(() => vi.resetAllMocks())
const request = (body: unknown) => new Request('http://localhost/api/paper-betting/tab-batch', { method: 'POST', body: JSON.stringify(body) })

it('validates jurisdiction, configuration and Tote-compatible stakes before loading any data', async () => {
  const preferences = picksHistoryPreset()
  expect((await POST(request({ preferences, jurisdiction: 'OTHER' }))).status).toBe(400)
  expect((await POST(request({ preferences: {}, jurisdiction: 'VIC' }))).status).toBe(400)
  preferences.settings.method = 'kelly-0.10'
  expect((await POST(request({ preferences, jurisdiction: 'VIC' }))).status).toBe(400)
  expect(createClient).not.toHaveBeenCalled()
})

it('returns an uncached read-only preview and never substitutes failed source reads', async () => {
  const preferences = picksHistoryPreset()
  vi.mocked(loadTabBatchPreview).mockResolvedValue({ text: 'MR-01-WP-00010.0-00000.0/1/' } as never)
  const response = await POST(request({ preferences, jurisdiction: 'NSW' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(loadTabBatchPreview).toHaveBeenCalledWith(undefined, preferences, 'NSW')
  vi.mocked(loadTabBatchPreview).mockRejectedValue(new Error('TAB unavailable'))
  expect((await POST(request({ preferences, jurisdiction: 'NSW' }))).status).toBe(503)
})