import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { placeBet, type PlaceBetInput } from '../paper-betting/repository'
import { legacyPaperBettingEnabled } from './legacy-betting'

it('blocks all legacy bet insertion before touching the database', async () => {
  const from = vi.fn()
  expect(legacyPaperBettingEnabled()).toBe(false)
  expect(await placeBet({ from } as unknown as SupabaseClient, {} as PlaceBetInput)).toEqual({ placed: false, reason: 'retired' })
  expect(from).not.toHaveBeenCalled()
})