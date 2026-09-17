import { describe, expect, it, vi } from 'vitest'
import { withSupabaseReadRetry } from './read-retry'

describe('Supabase read retries', () => {
  it.each([0, 408, 429, 500, 502, 520, 522])('retries returned transient HTTP %s errors', async status => {
    const success = { data: ['race'], error: null, status: 200 }
    const load = vi.fn().mockResolvedValueOnce({ error: { code: '', message: 'Upstream failure' }, status }).mockResolvedValue(success)
    expect(await withSupabaseReadRetry(load, 3, 0)).toBe(success)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retries thrown transport errors and returned statement timeouts', async () => {
    const success = { data: [], error: null, status: 200 }
    const load = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ error: { code: '57014' }, status: 500 }).mockResolvedValue(success)
    expect(await withSupabaseReadRetry(load, 3, 0)).toBe(success)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('does not retry permanent errors and preserves exhausted error responses', async () => {
    const permanent = { error: { code: '42703' }, status: 400 }
    const load = vi.fn().mockResolvedValue(permanent)
    expect(await withSupabaseReadRetry(load, 3, 0)).toBe(permanent)
    expect(load).toHaveBeenCalledTimes(1)
    const transient = { error: { code: '' }, status: 520 }
    load.mockClear().mockResolvedValue(transient)
    expect(await withSupabaseReadRetry(load, 3, 0)).toBe(transient)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('propagates an exhausted thrown error', async () => {
    const error = new TypeError('fetch failed')
    const load = vi.fn().mockRejectedValue(error)
    await expect(withSupabaseReadRetry(load, 2, 0)).rejects.toBe(error)
    expect(load).toHaveBeenCalledTimes(2)
  })
})