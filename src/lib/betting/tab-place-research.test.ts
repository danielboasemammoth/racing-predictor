import { expect, it } from 'vitest'
import type { SimulationRace } from './historical-simulator'
import { shrinkPlaceProbability, fitPlaceShrinkage } from './place-calibration-study'
import { TAB_PLACE_TRIAL, tabPlaceCalibration, tabPlaceProspectiveReport } from './tab-place-research'

function race(fieldSize = 8): SimulationRace {
  const paidPlaces = fieldSize === 7 ? 2 : 3
  return { id: 'race', start: '2026-10-07T01:00:00Z', settledAt: '2026-10-07T01:10:00Z', venue: 'Test', state: 'VIC', number: 1, fieldSize,
    selections: [], tabPlaceResearch: { ...TAB_PLACE_TRIAL },
    decisionSelections: Array.from({ length: fieldSize }, (_, index) => ({
      id: `horse-${index}`, horse: `Runner ${index}`, model: TAB_PLACE_TRIAL.model, rank: index + 1,
      predictedAt: '2026-10-07T00:00:00Z', evaluatedAt: '2026-10-07T00:55:00Z', tabQuotedAt: '2026-10-07T00:54:00Z', tabCapturedAt: '2026-10-07T00:54:30Z',
      winProbability: 1 / fieldSize, top3Probability: 3 / fieldSize, top2Probability: 2 / fieldSize, placeProbability: paidPlaces / fieldSize,
      placePaidPlaces: paidPlaces, placeTermsVerified: true, reliability: null, fullField: true,
      winOdds: index + 2, placeOdds: 5, winSource: 'tab_decision', placeSource: 'tab_decision', position: index + 1, scratched: false, winIssue: null, placeIssue: null,
    })) }
}

it('compares frozen favourite, middle and outsider policies with one flat stake per race', () => {
  const report = tabPlaceProspectiveReport([race()])
  expect(report).toMatchObject({ observedRaces: 1, eligibleRaces: 1, unknownTermsRaces: 0, productionChanged: false })
  expect(report.cohorts.filter(cohort => cohort.fieldSize === 8).map(cohort => cohort.summary)).toEqual([
    expect.objectContaining({ bets: 1, races: 1, staked: 1, profit: 4 }),
    expect.objectContaining({ bets: 1, races: 1, staked: 1, profit: 4 }),
    expect.objectContaining({ bets: 1, races: 1, staked: 1, profit: -1 }),
  ])
  expect(report.cohorts[5].risk).toMatchObject({ losingDays: 1, worstDay: -1, longestLosingStreak: 1, drawdown: 1, reviewReady: false })
})

it('excludes old observations, changed rules, unknown terms, stale quotes and incomplete fields', () => {
  expect(tabPlaceProspectiveReport([{ ...race(), tabPlaceResearch: undefined }]).observedRaces).toBe(0)
  const changed = JSON.parse(JSON.stringify(race())) as SimulationRace
  Object.assign(changed.tabPlaceResearch!, { minimumEdgePoints: 0 })
  expect(tabPlaceProspectiveReport([changed]).observedRaces).toBe(0)
  for (const override of [{ placeTermsVerified: false }, { tabQuotedAt: '2026-10-07T00:30:00Z' }, { fullField: false }, { scratched: true }]) {
    const source = race()
    Object.assign(source.decisionSelections![0], override)
    expect(tabPlaceProspectiveReport([source]).eligibleRaces).toBe(0)
  }
})

it('keeps seven-runner top-two calibration separate and does not fit a tiny sample', () => {
  const calibration = tabPlaceCalibration([race(7)])
  expect(calibration.map(group => [group.fieldSize, group.races, group.study])).toEqual([[7, 1, null], [8, 0, null]])
  expect(shrinkPlaceProbability(0.8, 7, 1, 2)).toBeCloseTo(2 / 7)
  const strength = fitPlaceShrinkage([{ raceId: 'race', startTime: '2026-10-07', paidPlaces: 2,
    runners: [{ horseId: 'horse', probability: 0.9, placed: false, odds: 2 }, { horseId: 'other', probability: 0.1, placed: true, odds: 2 }, { horseId: 'third', probability: 1, placed: true, odds: 2 }] }])
  expect(strength).toBe(1)
})

it('separates TAB calibration by chronological days without promoting a non-improving fit', () => {
  const samples = Array.from({ length: 150 }, (_, index) => {
    const sample = race()
    const shift = Math.floor(index / 15) * 86_400_000
    const move = (value: string) => new Date(Date.parse(value) + shift).toISOString()
    return { ...sample, id: `race-${index}`, start: move(sample.start), settledAt: move(sample.settledAt!),
      decisionSelections: sample.decisionSelections!.map(selection => ({ ...selection, predictedAt: move(selection.predictedAt),
        evaluatedAt: move(selection.evaluatedAt!), tabQuotedAt: move(selection.tabQuotedAt!), tabCapturedAt: move(selection.tabCapturedAt!) })) }
  })
  const result = tabPlaceCalibration(samples)[1]
  expect(result.study).toMatchObject({ trainingRaces: 90, validation: { raw: { races: 30 } }, untouchedTestRaces: 30, testWithheld: true, productionChanged: false, eligibleForProspectiveReview: false })
  expect(result.study!.days.train.at(-1)! < result.study!.days.validation[0]).toBe(true)
  expect(result.study!.days.validation.at(-1)! < result.study!.days.test[0]).toBe(true)
})