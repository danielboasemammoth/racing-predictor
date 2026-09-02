import { describe, expect, it } from 'vitest'
import { generateRaceRecommendations, MARKET_CONSENSUS_MODEL_VERSION } from '@/lib/paper-betting/generate-recommendations'
import type { PeNextToGoRace } from '@/lib/puntersedge/types'

const NOW = new Date('2026-09-01T06:00:00Z')

function race(overrides: Partial<PeNextToGoRace> = {}): PeNextToGoRace {
  return {
    race_id: 'race-1',
    venue: 'Geelong',
    race_number: 6,
    category: 'greyhound',
    start_time: '2026-09-01T06:20:00Z', // 20 minutes from NOW
    country: 'AU',
    runners: [
      {
        name: 'Favourite Dog',
        number: 1,
        bookmakers: [
          { key: 'tab', win_price: 4.2, age_seconds: 15 },
          { key: 'sportsbet', win_price: 5.0 },
          { key: 'neds', win_price: 4.6 },
        ],
      },
      {
        name: 'Second Dog',
        number: 2,
        bookmakers: [
          { key: 'tab', win_price: 2.0, age_seconds: 15 },
          { key: 'sportsbet', win_price: 1.9 },
          { key: 'neds', win_price: 1.95 },
        ],
      },
    ],
    scratchings: [],
    data_age_seconds: 15,
    stale: false,
    ...overrides,
  }
}

describe('generateRaceRecommendations', () => {
  it('produces one recommendation per runner with a model probability derived from cross-book consensus', () => {
    const results = generateRaceRecommendations(race(), { now: NOW })
    expect(results).toHaveLength(2)
    expect(results[0].modelProbability).not.toBeNull()
    expect(results[0].modelProbability! + results[1].modelProbability!).toBeCloseTo(1, 5)
  })

  it('flags a scratched runner as NO_BET regardless of its price', () => {
    const results = generateRaceRecommendations(
      race({ scratchings: [{ name: 'Favourite Dog', number: 1 }] }),
      { now: NOW },
    )
    expect(results[0].scratched).toBe(true)
    expect(results[0].decision).toBe('NO_BET')
  })

  it('returns NO_BET with a clear reason when a runner has no market price at all', () => {
    const results = generateRaceRecommendations(
      race({
        runners: [
          { name: 'No Price Dog', number: 1, bookmakers: [] },
          {
            name: 'Priced Dog',
            number: 2,
            bookmakers: [{ key: 'tab', win_price: 2.0, age_seconds: 10 }, { key: 'sportsbet', win_price: 2.0 }],
          },
        ],
      }),
      { now: NOW },
    )
    expect(results[0].modelProbability).toBeNull()
    expect(results[0].decision).toBe('NO_BET')
    expect(results[0].failedCriteria[0]).toMatch(/no market price/)
  })

  it('marks the race as started once past the advertised jump time, forcing NO_BET', () => {
    const results = generateRaceRecommendations(race(), { now: new Date('2026-09-01T06:25:00Z') })
    expect(results.every((r) => r.decision === 'NO_BET')).toBe(true)
  })

  it('reports feature completeness based on the number of bookmakers quoting the runner', () => {
    const results = generateRaceRecommendations(race(), { now: NOW })
    expect(results[0].numBookmakers).toBe(3)
    expect(results[0].featureCompleteness).toBeCloseTo(3 / 5, 5)
  })

  it('exports a stable model version string for storage alongside every recommendation', () => {
    expect(MARKET_CONSENSUS_MODEL_VERSION).toBe('market-consensus-v1')
  })

  it('excludes runners with an unresolved (null) program number rather than crashing (verified live)', () => {
    const results = generateRaceRecommendations(
      race({
        runners: [
          { name: 'Unresolved Dog', number: null, barrier: 1, bookmakers: [{ key: 'tab', win_price: 5.0 }] },
          {
            name: 'Resolved Dog',
            number: 2,
            bookmakers: [{ key: 'tab', win_price: 2.0, age_seconds: 10 }, { key: 'sportsbet', win_price: 2.0 }],
          },
        ],
      }),
      { now: NOW },
    )
    expect(results).toHaveLength(1)
    expect(results[0].runnerName).toBe('Resolved Dog')
  })

  it('computes a Harville place recommendation only when a TAB place price is available', () => {
    const noPlacePrice = generateRaceRecommendations(race(), { now: NOW })
    expect(noPlacePrice[0].place).toBeNull() // test fixture has no place_price

    const withPlacePrice = generateRaceRecommendations(
      race({
        runners: [
          { name: 'A', number: 1, bookmakers: [{ key: 'tab', win_price: 2.0, place_price: 1.2, age_seconds: 10 }] },
          { name: 'B', number: 2, bookmakers: [{ key: 'tab', win_price: 3.0, place_price: 1.5, age_seconds: 10 }] },
          { name: 'C', number: 3, bookmakers: [{ key: 'tab', win_price: 5.0, place_price: 1.8, age_seconds: 10 }] },
          { name: 'D', number: 4, bookmakers: [{ key: 'tab', win_price: 8.0, place_price: 2.2, age_seconds: 10 }] },
        ],
      }),
      { now: NOW },
    )
    expect(withPlacePrice[0].place).not.toBeNull()
    expect(withPlacePrice[0].place!.modelProbability).toBeGreaterThan(withPlacePrice[0].modelProbability!) // place prob > win prob
  })
})
