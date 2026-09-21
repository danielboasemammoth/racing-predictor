import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPageSnapshotReader, createPageSnapshotStore, refreshPageSnapshot, type PageSnapshotStore } from './page-cache'
import type { SupabaseClient } from '@supabase/supabase-js'

afterEach(() => vi.restoreAllMocks())

describe('persisted page snapshots', () => {
  it('disables automatic retries on latency-bounded snapshot reads', async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), retry: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    const db = { from: vi.fn(() => query) } as unknown as SupabaseClient
    expect(await createPageSnapshotStore(db).read('home')).toBeNull()
    expect(query.retry).toHaveBeenCalledWith(false)
  })
  it('reuses successful snapshots and coalesces simultaneous cold reads', async () => {
    const snapshot = { generatedAt: '2026-09-21T00:00:00Z', data: ['race'] }
    const store = { read: vi.fn().mockResolvedValue(snapshot), publish: vi.fn() }
    const read = createPageSnapshotReader(store)
    expect(await Promise.all([read('home'), read('home')])).toEqual([snapshot, snapshot])
    expect(await read('home')).toEqual(snapshot)
    expect(store.read).toHaveBeenCalledTimes(1)
  })

  it('serves last-good data during read failures without querying the expensive source', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const snapshot = { generatedAt: '2026-09-21T00:00:00Z', data: [] }
    const store = { read: vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValue(new Error('timeout')), publish: vi.fn() }
    const read = createPageSnapshotReader(store, 0)
    expect(await read('home')).toEqual(snapshot)
    expect(await read('home')).toEqual(snapshot)
    expect(await read('results')).toBeNull()
  })

  it('never publishes a failed refresh or replaces the old snapshot with an empty fallback', async () => {
    const store = { read: vi.fn(), publish: vi.fn() } as PageSnapshotStore
    await expect(refreshPageSnapshot(store, 'home', async () => { throw new Error('57014') })).rejects.toThrow('57014')
    expect(store.publish).not.toHaveBeenCalled()
    await refreshPageSnapshot(store, 'home', async () => [])
    expect(store.publish).toHaveBeenCalledWith('home', { generatedAt: expect.any(String), data: [] })
  })

  it('conditionally updates only older generations and never overwrites on an insert conflict', async () => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [], error: null }), upsert: vi.fn().mockResolvedValue({ error: null }) }
    const db = { from: vi.fn(() => query) } as unknown as SupabaseClient
    await createPageSnapshotStore(db).publish('home', { generatedAt: '2026-09-21T00:00:00Z', data: [] })
    expect(query.lt).toHaveBeenCalledWith('generated_at', '2026-09-21T00:00:00Z')
    expect(query.upsert).toHaveBeenCalledWith(expect.anything(), { onConflict: 'kind', ignoreDuplicates: true })
  })
})