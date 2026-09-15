import { describe, expect, it } from 'vitest'
import { buildPlaceStudyRace, fitPlaceShrinkage, runPlaceCalibrationStudy, scorePlaceStudy, shrinkPlaceProbability, splitPlaceStudy, type PlaceStudyRace } from './place-calibration-study'
import type { PredictionPayload } from '@/lib/types'

function race(day: number, id = `race-${day}`): PlaceStudyRace {
  return {
    raceId: id, startTime: `2026-09-${String(day).padStart(2, '0')}T03:00:00Z`,
    runners: Array.from({ length: 8 }, (_, index) => ({ horseId: `horse-${index}`, probability: index < 3 ? 0.9 : 0.06, placed: index < 3, odds: 2 })),
  }
}

describe('chronological place calibration study', () => {
  it('uses the latest pre-race forecast, never a late result-aware forecast or refreshed entry odds', () => {
    const sample = race(1)
    const payload: PredictionPayload = { podium: [], all_horses: sample.runners.map((runner, index) => ({
      horse_id: runner.horseId, horse_name: runner.horseId, predicted_position: index + 1, confidence: 0.1,
      top3_probability: runner.probability, place_odds: 2,
    })) }
    const entries = sample.runners.map((runner, index) => ({ horse_id: runner.horseId, status: 'active', finishing_position: index + 1 }))
    const inputRace = { id: sample.raceId, race_datetime: sample.startTime }
    const forecasts = [{ predicted_at: '2026-09-01T02:00:00Z', predictions: payload },
      { predicted_at: '2026-09-01T04:00:00Z', predictions: { ...payload, all_horses: [] } }]
    expect(buildPlaceStudyRace(inputRace, forecasts, entries).sample?.runners[0].odds).toBe(2)
    expect(buildPlaceStudyRace(inputRace, [forecasts[1]], entries).reason).toBe('no_pre_race_prediction')
    entries[7].status = 'scratched'
    expect(buildPlaceStudyRace(inputRace, forecasts, entries).sample).toBeNull()
  })

  it('keeps complete race days together in chronological order', () => {
    const rows = [race(5), race(2), race(1), race(4), race(3), race(3, 'same-day')]
    const split = splitPlaceStudy(rows)
    expect(split.train.map((row) => row.raceId)).toEqual(['race-1', 'race-2', 'race-3', 'same-day'])
    expect(split.validation.map((row) => row.raceId)).toEqual(['race-4'])
    expect(split.test.map((row) => row.raceId)).toEqual(['race-5'])
  })

  it('rejects duplicate races rather than leaking them across splits', () => {
    expect(() => splitPlaceStudy([race(1), race(1)])).toThrow('Duplicate race')
  })

  it('preserves bounds, ranking, and total paid places for complete fields', () => {
    const rows = race(1).runners
    const corrected = rows.map((row) => shrinkPlaceProbability(row.probability, 8, 0.5))
    expect(corrected.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(3)
    expect(corrected.every((probability) => probability >= 0 && probability <= 1)).toBe(true)
    expect(corrected[0]).toBeGreaterThan(corrected[7])
  })

  it('does not shrink an already accurate forecast toward a worse baseline', () => {
    expect(fitPlaceShrinkage([race(1)])).toBe(0)
  })

  it('fits a positive correction when extreme predictions point at the wrong runners', () => {
    const bad = race(1)
    bad.runners.forEach((runner, index) => { runner.placed = index >= 5 })
    const strength = fitPlaceShrinkage([bad])
    expect(strength).toBeGreaterThan(0)
    expect(scorePlaceStudy([bad], strength).brier).toBeLessThan(scorePlaceStudy([bad], 0).brier!)
  })

  it('withholds test scoring if validation fails; test outcomes cannot affect training', () => {
    const rows = Array.from({ length: 5 }, (_, index) => race(index + 1))
    const report = runPlaceCalibrationStudy(rows)
    rows[4].runners.forEach((runner) => { runner.placed = !runner.placed })
    expect(runPlaceCalibrationStudy(rows).strength).toBe(report.strength)
    expect(report.test).toBeNull()
    expect(report.testWithheld).toBe(true)
    expect(report.productionChanged).toBe(false)
  })

  it('opens the held-out test only after sufficient training and validation evidence', () => {
    const rows = Array.from({ length: 150 }, (_, index) => {
      const sample = race(Math.floor(index / 30) + 1, `race-${index}`)
      sample.runners.forEach((runner, runnerIndex) => { runner.placed = runnerIndex >= 5 })
      return sample
    })
    const report = runPlaceCalibrationStudy(rows)
    expect(report.validationPassed).toBe(true)
    expect(report.testWithheld).toBe(false)
    expect(report.test?.raw.races).toBe(30)
    expect(report.eligibleForProspectiveReview).toBe(true)
    const strength = report.strength
    rows.filter((sample) => sample.startTime.startsWith('2026-09-05')).forEach((sample) => {
      sample.runners.forEach((runner, index) => { runner.placed = index < 3 })
    })
    const changedTest = runPlaceCalibrationStudy(rows)
    expect(changedTest.strength).toBe(strength)
    expect(changedTest.validation).toEqual(report.validation)
    expect(changedTest.eligibleForProspectiveReview).toBe(false)
  })

  it('calculates returns only at recorded valid prices and treats empty selections as unknown ROI', () => {
    const sample = race(1)
    expect(scorePlaceStudy([sample], 0).valueSelections).toMatchObject({ bets: 3, races: 1, flatStakeRoiPct: 100 })
    sample.runners.forEach((runner) => { runner.odds = null })
    expect(scorePlaceStudy([sample], 0).valueSelections.flatStakeRoiPct).toBeNull()
  })
})