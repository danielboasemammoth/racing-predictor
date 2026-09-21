import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshPageCache } from './refresh-page-cache'

const mocks = vi.hoisted(() => ({ home: vi.fn(), results: vi.fn(), publish: vi.fn() }))
vi.mock('./page-snapshot-loaders', () => ({ pageLoaders: { home: mocks.home, results: mocks.results } }))
vi.mock('./page-cache', async importOriginal => ({
  ...await importOriginal<typeof import('./page-cache')>(),
  createPageSnapshotStore: () => ({ publish: mocks.publish }),
}))
afterEach(() => vi.restoreAllMocks())

it('continues after an upstream failure and publishes only successful snapshots', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.home.mockRejectedValue({ code: '522' })
  mocks.results.mockResolvedValue({ races: [] })
  mocks.publish.mockResolvedValue(undefined)
  const results = await refreshPageCache({} as SupabaseClient, ['home', 'results'])
  expect(results).toEqual([
    { key: 'home', ok: false, code: '522', milliseconds: expect.any(Number) },
    { key: 'results', ok: true, milliseconds: expect.any(Number) },
  ])
  expect(mocks.publish).toHaveBeenCalledTimes(1)
  expect(mocks.publish).toHaveBeenCalledWith('results', { generatedAt: expect.any(String), data: { races: [] } })
})