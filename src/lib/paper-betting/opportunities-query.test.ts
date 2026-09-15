import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { opportunityMarkets, queryLatestOpportunities, type OpportunityRow } from './opportunities-query'

const placeOnly = {
  id: 'new', runner_id: 'runner', decision: 'NO_BET', tab_win_price: null,
  place_decision: 'BET', tab_place_price: 1.8, place_model_probability: 0.7,
  place_edge_points: 14, place_expected_value: 0.26,
} as OpportunityRow

function mockClient(races: Array<{ id: string }>, recommendations: OpportunityRow[]) {
  const raceQuery = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: races, error: null }),
  }
  const recommendationQuery = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: recommendations, error: null }),
  }
  const from = vi.fn((table: string) => table === 'pe_races' ? raceQuery : recommendationQuery)
  return { client: { from } as unknown as SupabaseClient, raceQuery, recommendationQuery, from }
}

describe('latest market opportunities', () => {
  it('includes PLACE even with no WIN price or WIN recommendation', () => {
    expect(opportunityMarkets(placeOnly)).toMatchObject([{ betType: 'PLACE', price: 1.8, probability: 0.7 }])
  })

  it('does not revive an older BET after a newer NO_BET', async () => {
    const { client, raceQuery, recommendationQuery } = mockClient([{ id: 'race' }], [
        { ...placeOnly, place_decision: 'NO_BET' },
        { ...placeOnly, id: 'old' },
        { ...placeOnly, id: 'other', runner_id: 'other-runner' },
    ])
    const result = await queryLatestOpportunities(client, { limit: 1 })
    expect(result.map((row) => row.runner_id)).toEqual(['other-runner'])
    expect(raceQuery.gt).toHaveBeenCalledWith('start_time', expect.any(String))
    expect(raceQuery.eq).toHaveBeenCalledWith('status', 'upcoming')
    expect(recommendationQuery.in).toHaveBeenCalledWith('race_id', ['race'])
  })

  it('does not query historical recommendations when there are no upcoming races', async () => {
    const { client, from } = mockClient([], [])
    expect(await queryLatestOpportunities(client)).toEqual([])
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('bounds each recommendation query to at most twenty upcoming race IDs', async () => {
    const races = Array.from({ length: 45 }, (_, index) => ({ id: `race-${index}` }))
    const { client, recommendationQuery } = mockClient(races, [])
    await queryLatestOpportunities(client)
    expect(recommendationQuery.in.mock.calls.map((call) => call[1].length)).toEqual([20, 20, 5])
  })

  it('intersects explicit race filters with upcoming races and preserves category filters', async () => {
    const { client, raceQuery, recommendationQuery } = mockClient([{ id: 'keep' }, { id: 'other' }], [])
    await queryLatestOpportunities(client, { raceIds: ['keep', 'past'], category: 'horse' })
    expect(recommendationQuery.in).toHaveBeenCalledWith('race_id', ['keep'])
    expect(raceQuery.eq).toHaveBeenCalledWith('category', 'horse')
    expect(recommendationQuery.eq).toHaveBeenCalledWith('category', 'horse')
  })

  it('paginates snapshots before filtering decisions, even when the output limit is small', async () => {
    const { client, recommendationQuery } = mockClient([{ id: 'race' }], [])
    recommendationQuery.range.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, index) => ({
      ...placeOnly, runner_id: `skip-${index}`, place_decision: 'NO_BET',
    })), error: null }).mockResolvedValueOnce({ data: [placeOnly], error: null })
    expect(await queryLatestOpportunities(client, { limit: 1 })).toEqual([placeOnly])
    expect(recommendationQuery.range).toHaveBeenNthCalledWith(2, 1000, 1999)
  })
})