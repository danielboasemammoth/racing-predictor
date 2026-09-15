import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeValidationReport, marketPerformance, policyPerformance, type ValidationBet } from './validation-query'

const base: ValidationBet = {
  stake: 1, tab_decimal_odds: 2, edge_points: 20, model_probability: 0.7,
  status: 'WON', profit: 1, placed_at: '2026-09-15T01:00:00Z',
  bet_type: 'PLACE', race_id: 'race-1', source: 'internal', mode: 'AUTO', model_version: 'test',
}

describe('paper-bet market performance', () => {
  it('never assigns untagged or manual bets to the new automatic policy cohort', () => {
    const groups = policyPerformance([base, { ...base, policy_version: 'internal-value-v1' },
      { ...base, policy_version: 'internal-value-v1', mode: 'MANUAL' }])
    expect(groups).toHaveLength(3)
    expect(groups.map((group) => [group.policyVersion, group.mode, group.markets[0].n])).toEqual([
      ['untagged', 'AUTO', 1], ['internal-value-v1', 'AUTO', 1], ['internal-value-v1', 'MANUAL', 1],
    ])
  })
  it('separates WIN from PLACE and compares expected with realised results', () => {
    const rows = marketPerformance([base, { ...base, stake: 3, status: 'LOST', profit: -3 },
      { ...base, bet_type: 'WIN', profit: 2, tab_decimal_odds: 3 }])
    expect(rows[0]).toMatchObject({ n: 1, roiPct: 200 })
    expect(rows[2]).toMatchObject({ n: 2, races: 1, winRate: 0.5, roiPct: -50, netProfit: -2 })
    expect(rows[2].expectedHitRate).toBeCloseTo(0.7)
    expect(rows[2].expectedRoiPct).toBeCloseTo(40)
  })

  it('requires both high chance and value for the subset', () => {
    const rows = marketPerformance([base, { ...base, model_probability: 0.5, tab_decimal_odds: 3 },
      { ...base, model_probability: 0.8, tab_decimal_odds: 1.1 }])
    expect(rows[2].n).toBe(3)
    expect(rows[3].n).toBe(1)
  })

  it('does not present an empty cohort as a zero-return strategy', () => {
    expect(marketPerformance([]).every((row) => row.n === 0 && row.roiPct === null && row.winRate === null)).toBe(true)
  })

  it('paginates past 1000 settled bets', async () => {
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => base), error: null })
        .mockResolvedValueOnce({ data: [base], error: null }),
    }
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient
    const report = await computeValidationReport(client, 'account')
    expect(report.totalSettled).toBe(1001)
    expect(query.range).toHaveBeenNthCalledWith(2, 1000, 1999)
    expect(report.markets[2].n).toBe(1001)
  })
})