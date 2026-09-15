import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { opportunityMarkets, queryLatestOpportunities, type OpportunityRow } from './opportunities-query'

const placeOnly = {
  id: 'new', runner_id: 'runner', decision: 'NO_BET', tab_win_price: null,
  place_decision: 'BET', tab_place_price: 1.8, place_model_probability: 0.7,
  place_edge_points: 14, place_expected_value: 0.26,
} as OpportunityRow

describe('latest market opportunities', () => {
  it('includes PLACE even with no WIN price or WIN recommendation', () => {
    expect(opportunityMarkets(placeOnly)).toMatchObject([{ betType: 'PLACE', price: 1.8, probability: 0.7 }])
  })

  it('does not revive an older BET after a newer NO_BET', async () => {
    const query = {
      select: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [
        { ...placeOnly, place_decision: 'NO_BET' },
        { ...placeOnly, id: 'old' },
        { ...placeOnly, id: 'other', runner_id: 'other-runner' },
      ], error: null }),
    }
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient
    const result = await queryLatestOpportunities(client, { limit: 1 })
    expect(result.map((row) => row.runner_id)).toEqual(['other-runner'])
    expect(query.gt).toHaveBeenCalledWith('pe_races.start_time', expect.any(String))
  })
})