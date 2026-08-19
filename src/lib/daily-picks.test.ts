import { describe, expect, it } from 'vitest'
import { getDailyPicks, getTomorrowPicks } from '@/lib/daily-picks'
import type { Prediction, RaceWithPrediction } from '@/lib/types'

function race(id: string, date: string, win: number, top3: number, secondWin: number, odds: number): RaceWithPrediction {
  const prediction: Prediction = {
    id: `prediction-${id}`,
    race_id: id,
    model_version: 'test',
    predicted_at: '2026-08-16T00:00:00Z',
    predictions: {
      podium: [
        { horse_id: `horse-${id}`, horse_name: `Horse ${id}`, predicted_position: 1, confidence: win, win_probability: win, top3_probability: top3, win_odds: odds },
        { horse_id: `second-${id}`, horse_name: `Second ${id}`, predicted_position: 2, confidence: secondWin, win_probability: secondWin },
      ],
      all_horses: [],
      feature_snapshots: {
        [`horse-${id}`]: { features: { historyStarts: 5 } },
      },
    },
    confidence_scores: { overall: win, winner: win, podium: top3 },
    predicted_times: {},
  }
  return {
    id,
    racecourse_id: 'course',
    race_number: 1,
    race_datetime: date,
    status: 'upcoming',
    prediction,
  }
}

describe('daily conservative picks', () => {
  it('ranks only Melbourne-today races by certainty', () => {
    const picks = getDailyPicks([
      race('strong', '2026-08-16T03:00:00Z', 0.35, 0.75, 0.15, 2),
      race('weak', '2026-08-16T04:00:00Z', 0.18, 0.48, 0.16, 50),
      race('tomorrow', '2026-08-17T03:00:00Z', 0.6, 0.9, 0.1, 2),
    ], new Date('2026-08-16T01:00:00Z'))

    expect(picks.map((pick) => pick.race.id)).toEqual(['strong', 'weak'])
  })

  it('does not use payout odds when ranking picks', () => {
    const lowOdds = race('alpha', '2026-08-16T03:00:00Z', 0.3, 0.7, 0.15, 1.2)
    const highOdds = race('beta', '2026-08-16T04:00:00Z', 0.2, 0.5, 0.18, 100)

    expect(getDailyPicks([lowOdds, highOdds], new Date('2026-08-16T01:00:00Z'))[0].race.id).toBe('alpha')
    lowOdds.prediction!.predictions.podium[0].win_odds = 500
    highOdds.prediction!.predictions.podium[0].win_odds = 1.01
    expect(getDailyPicks([lowOdds, highOdds], new Date('2026-08-16T01:00:00Z'))[0].race.id).toBe('alpha')
  })

  it('ranks tomorrow\'s Melbourne races separately from today\'s', () => {
    const picks = getTomorrowPicks([
      race('today', '2026-08-16T03:00:00Z', 0.35, 0.75, 0.15, 2),
      race('tomorrow-strong', '2026-08-17T03:00:00Z', 0.4, 0.8, 0.1, 3),
      race('tomorrow-weak', '2026-08-17T05:00:00Z', 0.2, 0.5, 0.18, 20),
    ], new Date('2026-08-16T01:00:00Z'))

    expect(picks.map((pick) => pick.race.id)).toEqual(['tomorrow-strong', 'tomorrow-weak'])
  })
})
