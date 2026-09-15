import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supportsPolicyTracking } from './policy-tracking'

function client(error: { code: string; message: string } | null) {
  const query = { select: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ error }) }
  return { from: vi.fn(() => query) } as unknown as SupabaseClient
}

describe('policy migration compatibility', () => {
  it('recognizes an available policy column', async () => {
    expect(await supportsPolicyTracking(client(null))).toBe(true)
  })

  it.each(['42703', 'PGRST204'])('recognizes a missing policy column: %s', async (code) => {
    expect(await supportsPolicyTracking(client({ code, message: 'Missing policy_version column' }))).toBe(false)
  })

  it('does not hide permission or unrelated database failures', async () => {
    const error = { code: '42501', message: 'permission denied' }
    await expect(supportsPolicyTracking(client(error))).rejects.toEqual(error)
  })
})