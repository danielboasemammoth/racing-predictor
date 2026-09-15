import { beforeEach, describe, expect, it, vi } from 'vitest'
import { autoPlaceReliabilityBets, evaluateInternalValueCandidates, internalValueCandidates } from './reliability-auto-bet'
import type { RaceWithPrediction } from '@/lib/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUpcomingRaces } from '@/lib/upcoming-races'
import { placeBet } from './repository'
import { supportsPolicyTracking } from './policy-tracking'

vi.mock('./policy-tracking', () => ({ INTERNAL_VALUE_POLICY_VERSION: 'internal-value-v1', supportsPolicyTracking: vi.fn().mockResolvedValue(true) }))

vi.mock('@/lib/upcoming-races', () => ({ getUpcomingRaces: vi.fn() }))
vi.mock('@/lib/reliability-context', () => ({ loadReliabilityContext: vi.fn().mockResolvedValue(null) }))
vi.mock('./repository', () => ({
  getOrCreateAccount: vi.fn().mockResolvedValue({ id: 'account', current_bankroll: 50, staking_method: 'flat-1pct' }),
  placeBet: vi.fn(),
}))

function fixture(fieldSize = 8) {
  const horses = Array.from({ length: fieldSize }, (_, index) => ({
    horse_id: `horse-${index}`, horse_name: `Horse ${index}`, predicted_position: index + 1,
    confidence: 0.1, win_probability: index === 0 ? 0.4 : 0.1,
    top3_probability: index === 1 ? 0.7 : 0.3,
    win_odds: 2, place_odds: 1.8,
  }))
  const race = {
    prediction: { predictions: { all_horses: horses, podium: horses.slice(0, 3) } },
  } as RaceWithPrediction
  return { race, horses, active: new Set(horses.map((horse) => horse.horse_id)) }
}

describe('internal value paper bets', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('accounts for every runner/market exactly once with a first rejection reason', () => {
    const { race, active } = fixture()
    const result = evaluateInternalValueCandidates(race, active, 'horse-0')
    expect(result.marketsConsidered).toBe(16)
    expect(result.rejected).toMatchObject({ win_reliability: 7, nonpositive_ev: 1, place_chance: 7 })
    expect(Object.values(result.rejected).reduce((sum, count) => sum + count, 0) + result.candidates.length).toBe(16)
    expect(result.candidates).toEqual(internalValueCandidates(race, active, 'horse-0'))
  })

  it('places and records a PLACE bet without win calibration, using a stable market-specific key', async () => {
    const { race, horses } = fixture()
    Object.assign(race, { id: 'race', status: 'upcoming', race_datetime: '2026-09-15T03:00:00Z' })
    Object.assign(race.prediction!, { predicted_at: '2026-09-15T01:00:00Z', model_version: 'test' })
    vi.mocked(getUpcomingRaces).mockResolvedValue([race])
    vi.mocked(placeBet).mockResolvedValueOnce({ placed: true, betId: 'bet' })
      .mockResolvedValueOnce({ placed: false, reason: 'duplicate' })
    const query = {
      select: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      eq: vi.fn().mockResolvedValue({ data: horses.map((horse) => ({ horse_id: horse.horse_id, status: 'active' })), error: null }),
    }
    const admin = { from: vi.fn(() => query) } as unknown as SupabaseClient
    const now = new Date('2026-09-15T02:00:00Z')
    expect(await autoPlaceReliabilityBets(admin, now)).toMatchObject({ betsPlaced: 1, placeBetsPlaced: 1, winBetsPlaced: 0 })
    expect(vi.mocked(placeBet).mock.calls[0][1]).toMatchObject({
      betType: 'PLACE', modelProbability: 0.7, tabDecimalOdds: 1.8,
      idempotencyKey: 'auto-reliability:race:horse-1:PLACE', source: 'internal', mode: 'AUTO',
      policyVersion: 'internal-value-v1',
    })
    expect(vi.mocked(placeBet).mock.calls[0][1].expectedValue).toBeCloseTo(0.26)
    expect(await autoPlaceReliabilityBets(admin, now)).toMatchObject({ betsPlaced: 0, skippedDuplicate: 1 })
    expect(vi.mocked(placeBet).mock.calls[1][1].idempotencyKey).toBe(vi.mocked(placeBet).mock.calls[0][1].idempotencyKey)
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'paper-policy-latest-run' }), { onConflict: 'kind' })
    vi.mocked(supportsPolicyTracking).mockResolvedValueOnce(false)
    vi.mocked(placeBet).mockResolvedValueOnce({ placed: false, reason: 'duplicate' })
    expect(await autoPlaceReliabilityBets(admin, now)).toMatchObject({ policyTrackingAvailable: false })
    expect(vi.mocked(placeBet).mock.calls[2][1].policyVersion).toBeUndefined()
  })

  it('selects a high-chance value PLACE runner independently of the WIN shortlist', () => {
    const { race, active } = fixture()
    const candidates = internalValueCandidates(race, active)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ betType: 'PLACE', probability: 0.7, horse: { horse_id: 'horse-1' } })
    expect(candidates[0].ev).toBeCloseTo(0.26)
  })

  it('rejects a negative-value WIN even when reliability qualifies it', () => {
    const { race, active } = fixture()
    expect(internalValueCandidates(race, active, 'horse-0').every((candidate) => candidate.betType !== 'WIN')).toBe(true)
  })

  it('admits positive-value WIN and PLACE markets separately', () => {
    const { race, active, horses } = fixture()
    horses[0].win_odds = 3
    expect(internalValueCandidates(race, active, 'horse-0').map((candidate) => candidate.betType)).toEqual(['PLACE', 'WIN'])
  })

  it.each([4, 5, 7])('does not use top-three probability for a %i-runner paid market', (fieldSize) => {
    const { race, active } = fixture(fieldSize)
    expect(internalValueCandidates(race, active)).toEqual([])
  })

  it('rejects predictions whose field no longer matches current active starters', () => {
    const { race, active } = fixture(9)
    active.delete('horse-0')
    expect(internalValueCandidates(race, active)).toEqual([])
  })

  it.each([0, 1, Number.NaN, Number.POSITIVE_INFINITY, 20])('rejects invalid or excessive place odds %s', (odds) => {
    const { race, active, horses } = fixture()
    horses[1].place_odds = odds
    expect(internalValueCandidates(race, active)).toEqual([])
  })

  it.each([0.5, Number.NaN, 1.1])('rejects low or invalid place probability %s', (probability) => {
    const { race, active, horses } = fixture()
    horses[1].top3_probability = probability
    expect(internalValueCandidates(race, active)).toEqual([])
  })
})