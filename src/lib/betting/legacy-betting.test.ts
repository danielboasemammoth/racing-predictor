import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { placeBet, type PlaceBetInput } from '../paper-betting/repository'
import { legacyPaperBettingEnabled } from './legacy-betting'

afterEach(() => vi.unstubAllEnvs())

it('blocks all legacy bet insertion before touching the database', async () => {
  vi.stubEnv('LEGACY_PAPER_BETTING_ENABLED', 'false')
  const from = vi.fn()
  expect(legacyPaperBettingEnabled()).toBe(false)
  expect(await placeBet({ from } as unknown as SupabaseClient, {} as PlaceBetInput)).toEqual({ placed: false, reason: 'retired' })
  expect(from).not.toHaveBeenCalled()
})

it('requires an explicit true value to resume simulated placement', () => {
  for (const value of ['', 'false', '1', 'TRUE']) {
    vi.stubEnv('LEGACY_PAPER_BETTING_ENABLED', value)
    expect(legacyPaperBettingEnabled()).toBe(false)
  }
  vi.stubEnv('LEGACY_PAPER_BETTING_ENABLED', 'true')
  expect(legacyPaperBettingEnabled()).toBe(true)
})