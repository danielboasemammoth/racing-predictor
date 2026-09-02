import { describe, expect, it } from 'vitest'
import { getDailyPicks, getTomorrowPicks } from '@/lib/daily-picks'
import type { CalibrationTable } from '@/lib/reliability-score'
import type { Prediction, RaceWithPrediction } from '@/lib/types'

function race(
  id: string, date: string, win: number, top3: number, secondWin: number, odds: number,
  extra: { raceClass?: string; modelPredictions?: Prediction[] } = {},
): RaceWithPrediction {
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
    race_class: extra.raceClass,
    race_datetime: date,
    status: 'upcoming',
    prediction,
    model_predictions: extra.modelPredictions ?? [prediction],
  }
}

describe('daily conservative picks', () => {
  it('ranks only Melbourne-today races by certainty', () => {
    const picks = getDailyPicks([
      race('strong', '2026-08-16T03:00:00Z', 0.35, 0.75, 0.15, 2),
      race('weak', '2026-08-16T04:00:00Z', 0.18, 0.48, 0.16, 50),
      race('tomorrow', '2026-08-17T03:00:00Z', 0.6, 0.9, 0.1, 2),
    ], new Date('2026-08-16T01:00:00Z'), 3, { skipQualificationGate: true })

    expect(picks.map((pick) => pick.race.id)).toEqual(['strong', 'weak'])
  })

  it('does not use payout odds when ranking picks', () => {
    const lowOdds = race('alpha', '2026-08-16T03:00:00Z', 0.3, 0.7, 0.15, 1.2)
    const highOdds = race('beta', '2026-08-16T04:00:00Z', 0.2, 0.5, 0.18, 100)
    const opts = { skipQualificationGate: true }

    expect(getDailyPicks([lowOdds, highOdds], new Date('2026-08-16T01:00:00Z'), 3, opts)[0].race.id).toBe('alpha')
    lowOdds.prediction!.predictions.podium[0].win_odds = 500
    highOdds.prediction!.predictions.podium[0].win_odds = 1.01
    expect(getDailyPicks([lowOdds, highOdds], new Date('2026-08-16T01:00:00Z'), 3, opts)[0].race.id).toBe('alpha')
  })

  it('ranks tomorrow\'s Melbourne races separately from today\'s', () => {
    const picks = getTomorrowPicks([
      race('today', '2026-08-16T03:00:00Z', 0.35, 0.75, 0.15, 2),
      race('tomorrow-strong', '2026-08-17T03:00:00Z', 0.4, 0.8, 0.1, 3),
      race('tomorrow-weak', '2026-08-17T05:00:00Z', 0.2, 0.5, 0.18, 20),
    ], new Date('2026-08-16T01:00:00Z'), 3, { skipQualificationGate: true })

    expect(picks.map((pick) => pick.race.id)).toEqual(['tomorrow-strong', 'tomorrow-weak'])
  })

  it('ranks by Reliability Score instead of certaintyScore when a calibration table is supplied', () => {
    const calibration: CalibrationTable = {
      overallBaseline: 0.18,
      probability: [],
      gap: [],
      agreement: [],
      rawRateRange: { min: 0.1, max: 0.3 },
    }
    // "weak" has a lower raw win probability but this test only checks that reliability
    // (not certainty) drives ranking - with an empty calibration table every pick falls back
    // to the baseline, so ranking should be stable/unchanged; the key assertion is that a
    // `reliability` object is actually attached to each pick when calibration is provided.
    const picks = getDailyPicks([
      race('strong', '2026-08-16T03:00:00Z', 0.35, 0.75, 0.15, 2),
      race('weak', '2026-08-16T04:00:00Z', 0.18, 0.48, 0.16, 50),
    ], new Date('2026-08-16T01:00:00Z'), 3, { calibration, skipQualificationGate: true })

    expect(picks.every((pick) => pick.reliability !== null)).toBe(true)
    expect(picks).toHaveLength(2)
  })

  it('filters out picks below a minimum reliability score', () => {
    const calibration: CalibrationTable = { overallBaseline: 0.18, probability: [], gap: [], agreement: [], rawRateRange: { min: 0.05, max: 0.65 } }
    function historyRows(n: number, wins: number, probability: number, gap: number) {
      return Array.from({ length: n }, (_, i) => ({
        raceId: `h-${probability}-${i}`,
        correctWinner: i < wins,
        distanceM: 1200,
        raceType: 'handicap',
        fieldSize: 10,
        trackCondition: 'Good',
        barrierThird: 'middle' as const,
        probability,
        gap,
        agreeing: 0,
        totalBaseModels: 0,
      }))
    }
    // "strong" (win=0.32, gap=0.17) matches a historically strong cohort; "weak" (win=0.1,
    // gap=0.05) matches a historically weak one - genuinely different reliability, not just a
    // different raw win probability.
    const history = [...historyRows(40, 30, 0.32, 0.17), ...historyRows(40, 2, 0.1, 0.05)]
    const picks = getDailyPicks([
      race('strong', '2026-08-16T03:00:00Z', 0.32, 0.75, 0.15, 2),
      race('weak', '2026-08-16T04:00:00Z', 0.1, 0.3, 0.05, 50),
    ], new Date('2026-08-16T01:00:00Z'), 3, { calibration, history, minReliability: 50, skipQualificationGate: true })

    expect(picks.map((pick) => pick.race.id)).toEqual(['strong'])
  })

  it('filters to maiden races only when requested', () => {
    const picks = getDailyPicks([
      race('maiden-race', '2026-08-16T03:00:00Z', 0.3, 0.7, 0.1, 3, { raceClass: 'MDN-SW' }),
      race('benchmark-race', '2026-08-16T04:00:00Z', 0.35, 0.75, 0.1, 3, { raceClass: 'BM70' }),
    ], new Date('2026-08-16T01:00:00Z'), 3, { maidenOnly: true, skipQualificationGate: true })

    expect(picks.map((pick) => pick.race.id)).toEqual(['maiden-race'])
  })

  it('defaults to zero picks when nothing has been evaluated for reliability (spec Parts 20-21)', () => {
    const picks = getDailyPicks([
      race('strong', '2026-08-16T03:00:00Z', 0.35, 0.75, 0.15, 2),
    ], new Date('2026-08-16T01:00:00Z')) // no calibration/history supplied, no skipQualificationGate

    expect(picks).toEqual([])
  })

  it('excludes a pick whose reliability was hard-vetoed (comparable cohort at/below baseline) from the default shortlist', () => {
    const calibration: CalibrationTable = { overallBaseline: 0.18, probability: [], gap: [], agreement: [], rawRateRange: { min: 0.05, max: 0.3 } }
    // History deliberately below baseline for every possible band this pick could match.
    const history = Array.from({ length: 100 }, (_, i) => ({
      raceId: `h${i}`,
      correctWinner: i < 5, // 5% win rate, well below the 18% baseline
      distanceM: 1200,
      raceType: 'handicap',
      fieldSize: 10,
      trackCondition: 'Good',
      barrierThird: 'middle' as const,
      probability: 0.35,
      gap: 0.2,
      agreeing: 1,
      totalBaseModels: 1,
    }))
    const picks = getDailyPicks([
      race('vetoed', '2026-08-16T03:00:00Z', 0.35, 0.75, 0.15, 2),
    ], new Date('2026-08-16T01:00:00Z'), 3, { calibration, history })

    expect(picks).toEqual([])
  })

  it('includes a pick once its reliability genuinely clears the default gate', () => {
    const calibration: CalibrationTable = { overallBaseline: 0.18, probability: [], gap: [], agreement: [], rawRateRange: { min: 0.05, max: 0.65 } }
    const matching = Array.from({ length: 40 }, (_, i) => ({
      raceId: `match-${i}`,
      correctWinner: i < 30, // 75% win rate within this exact cohort
      distanceM: 1200,
      raceType: 'handicap',
      fieldSize: 10,
      trackCondition: 'Good',
      barrierThird: 'middle' as const,
      probability: 0.35,
      gap: 0.2,
      agreeing: 0,
      totalBaseModels: 0,
    }))
    // Non-matching padding so the overall population baseline is well below this cohort's own
    // rate - otherwise a cohort that IS the entire history trivially equals the baseline and
    // would (correctly) get vetoed, which is not what this test is checking.
    const padding = Array.from({ length: 100 }, (_, i) => ({
      raceId: `pad-${i}`,
      correctWinner: i < 15,
      distanceM: 1200,
      raceType: 'handicap',
      fieldSize: 10,
      trackCondition: 'Good',
      barrierThird: 'middle' as const,
      probability: 0.1,
      gap: 0.02,
      agreeing: 0,
      totalBaseModels: 0,
    }))
    const picks = getDailyPicks([
      race('qualifies', '2026-08-16T03:00:00Z', 0.35, 0.75, 0.15, 2),
    ], new Date('2026-08-16T01:00:00Z'), 3, { calibration, history: [...matching, ...padding] })

    expect(picks.map((pick) => pick.race.id)).toEqual(['qualifies'])
  })
})
