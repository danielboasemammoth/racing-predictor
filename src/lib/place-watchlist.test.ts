import { describe, expect, it } from 'vitest'
import { getPlaceWatchlist } from './place-watchlist'
import { getDailyPicks } from './daily-picks'
import type { RaceWithPrediction } from './types'

const now = new Date('2026-09-17T00:00:00Z')
function fixture(): RaceWithPrediction {
  const horses = [
    { horse_id: 'winner', horse_name: 'Winner', predicted_position: 1, confidence: 0.3, top3_probability: 0.49 },
    { horse_id: 'place', horse_name: 'Place', predicted_position: 2, confidence: 0.2, top3_probability: 0.65 },
    { horse_id: 'boundary', horse_name: 'Boundary', predicted_position: 3, confidence: 0.1, top3_probability: 0.5 },
  ]
  return {
    id: 'race', racecourse_id: 'course', race_number: 1, status: 'upcoming', race_datetime: '2026-09-17T03:00:00Z',
    prediction: {
      id: 'prediction', race_id: 'race', model_version: 'v6-market-blend', predicted_at: '2026-09-16T20:00:00Z',
      predictions: { podium: horses.slice(0, 1), all_horses: horses }, confidence_scores: { overall: 0.3 }, predicted_times: {},
    },
  }
}

describe('PLACE probability watchlist', () => {
  it('includes non-winners at or above 50% without weakening conservative eligibility', () => {
    const race = fixture()
    expect(getPlaceWatchlist([race], '2026-09-17', now).map(pick => pick.horse.horse_id)).toEqual(['place', 'boundary'])
    expect(getDailyPicks([race], now)).toEqual([])
  })

  it('keeps days separate and excludes past, cancelled, and future-generated forecasts', () => {
    const race = fixture()
    expect(getPlaceWatchlist([race], '2026-09-18', now)).toEqual([])
    expect(getPlaceWatchlist([race], '2026-09-17', new Date('2026-09-17T03:00:00Z'))).toEqual([])
    expect(getPlaceWatchlist([{ ...race, status: 'cancelled' }], '2026-09-17', now)).toEqual([])
    race.prediction!.predicted_at = '2026-09-17T01:00:00Z'
    expect(getPlaceWatchlist([race], '2026-09-17', now)).toEqual([])
  })

  it('never substitutes a win-derived estimate for missing or invalid top-three probabilities', () => {
    const race = fixture()
    for (const probability of [undefined, NaN, Infinity, 1.1, -0.2]) {
      race.prediction!.predictions.all_horses = [{ ...race.prediction!.predictions.podium[0], top3_probability: probability }]
      expect(getPlaceWatchlist([race], '2026-09-17', now)).toEqual([])
    }
  })

  it('supports older podium-only forecasts without duplicating runners', () => {
    const race = fixture()
    const horse = race.prediction!.predictions.all_horses[1]
    race.prediction!.predictions.all_horses = []
    race.prediction!.predictions.podium = [horse, horse]
    expect(getPlaceWatchlist([race], '2026-09-17', now)).toHaveLength(1)
  })
})