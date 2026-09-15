import { brierScore, logLoss } from './calibration'
import { expectedValue, probabilityEdgePoints } from './odds-math'
import { melbourneDateKey } from '@/lib/daily-picks'
import type { PredictionPayload } from '@/lib/types'

export const PLACE_STUDY_VALUE_RULES = Object.freeze({ minProbability: 0.6, minEdgePoints: 5, maxOdds: 15 })

export interface PlaceStudyPrediction { predicted_at: string; predictions: PredictionPayload }
export interface PlaceStudyEntry { horse_id: string; status: string; finishing_position: number | null }

export function buildPlaceStudyRace(
  race: { id: string; race_datetime: string }, predictions: PlaceStudyPrediction[], entries: PlaceStudyEntry[],
): { sample: PlaceStudyRace | null; reason: string | null } {
  const active = entries.filter((entry) => entry.status !== 'scratched')
  if (active.length < 8) return { sample: null, reason: 'not_three_place_field' }
  if (new Set(active.map((entry) => entry.horse_id)).size !== active.length) return { sample: null, reason: 'duplicate_entries' }
  if (active.some((entry) => entry.finishing_position == null || !Number.isInteger(entry.finishing_position) || entry.finishing_position < 1)
    || [1, 2, 3].some((position) => active.filter((entry) => entry.finishing_position === position).length !== 1)) return { sample: null, reason: 'incomplete_or_ambiguous_result' }
  const prediction = [...predictions].filter((row) => Date.parse(row.predicted_at) < Date.parse(race.race_datetime))
    .sort((left, right) => Date.parse(right.predicted_at) - Date.parse(left.predicted_at))[0]
  if (!prediction) return { sample: null, reason: 'no_pre_race_prediction' }
  const horses = prediction.predictions.all_horses ?? []
  if (horses.length !== active.length || new Set(horses.map((horse) => horse.horse_id)).size !== active.length
    || !horses.every((horse) => active.some((entry) => entry.horse_id === horse.horse_id))) return { sample: null, reason: 'field_mismatch' }
  if (horses.some((horse) => horse.top3_probability == null || !Number.isFinite(horse.top3_probability) || horse.top3_probability < 0 || horse.top3_probability > 1)
    || Math.abs(horses.reduce((sum, horse) => sum + (horse.top3_probability ?? 0), 0) - 3) > 0.001) return { sample: null, reason: 'invalid_place_distribution' }
  return {
    reason: null,
    sample: {
      raceId: race.id, startTime: race.race_datetime,
      runners: horses.map((horse) => ({
        horseId: horse.horse_id,
        probability: horse.top3_probability!,
        placed: active.find((entry) => entry.horse_id === horse.horse_id)!.finishing_position! <= 3,
        odds: horse.place_odds != null && Number.isFinite(horse.place_odds) && horse.place_odds > 1 ? horse.place_odds : null,
      })),
    },
  }
}

export interface PlaceStudyRace {
  raceId: string
  startTime: string
  runners: Array<{ horseId: string; probability: number; placed: boolean; odds: number | null }>
}

export function splitPlaceStudy(races: PlaceStudyRace[]) {
  if (new Set(races.map((race) => race.raceId)).size !== races.length) throw new Error('Duplicate race in place study')
  const sorted = [...races].sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime) || left.raceId.localeCompare(right.raceId))
  const days = [...new Set(sorted.map((race) => melbourneDateKey(race.startTime)))]
  if (days.length < 5) throw new Error('At least five race days are required for train/validation/test separation')
  const trainEnd = Math.floor(days.length * 0.6)
  const validationEnd = Math.floor(days.length * 0.8)
  const trainDays = new Set(days.slice(0, trainEnd))
  const validationDays = new Set(days.slice(trainEnd, validationEnd))
  const testDays = new Set(days.slice(validationEnd))
  return {
    train: sorted.filter((race) => trainDays.has(melbourneDateKey(race.startTime))),
    validation: sorted.filter((race) => validationDays.has(melbourneDateKey(race.startTime))),
    test: sorted.filter((race) => testDays.has(melbourneDateKey(race.startTime))),
    days: { train: [...trainDays], validation: [...validationDays], test: [...testDays] },
  }
}

export function shrinkPlaceProbability(probability: number, fieldSize: number, strength: number) {
  return probability * (1 - strength) + (3 / fieldSize) * strength
}

export function fitPlaceShrinkage(trainingRaces: PlaceStudyRace[]): number {
  let numerator = 0
  let denominator = 0
  for (const race of trainingRaces) {
    const fieldSize = race.runners.length
    for (const runner of race.runners) {
      const direction = 3 / fieldSize - runner.probability
      numerator += (Number(runner.placed) - runner.probability) * direction / fieldSize
      denominator += direction ** 2 / fieldSize
    }
  }
  return denominator > 0 ? Math.max(0, Math.min(1, numerator / denominator)) : 0
}

export function scorePlaceStudy(races: PlaceStudyRace[], strength: number) {
  let brierTotal = 0
  let lossTotal = 0
  let expectedHits = 0
  let actualHits = 0
  let sampleCount = 0
  let pricedRunners = 0
  const selections: Array<{ raceId: string; probability: number; placed: boolean; odds: number }> = []
  for (const race of races) {
    const samples = race.runners.map((runner) => {
      const probability = shrinkPlaceProbability(runner.probability, race.runners.length, strength)
      if (runner.odds != null && Number.isFinite(runner.odds) && runner.odds > 1) {
        pricedRunners += 1
        if (probability >= PLACE_STUDY_VALUE_RULES.minProbability && runner.odds <= PLACE_STUDY_VALUE_RULES.maxOdds
          && probabilityEdgePoints(probability, runner.odds) >= PLACE_STUDY_VALUE_RULES.minEdgePoints
          && expectedValue(probability, runner.odds) > 0) selections.push({ raceId: race.raceId, probability, placed: runner.placed, odds: runner.odds })
      }
      expectedHits += probability
      actualHits += Number(runner.placed)
      sampleCount += 1
      return { modelProbability: probability, won: runner.placed }
    })
    brierTotal += brierScore(samples) ?? 0
    lossTotal += logLoss(samples) ?? 0
  }
  return {
    races: races.length,
    runners: sampleCount,
    brier: races.length ? brierTotal / races.length : null,
    logLoss: races.length ? lossTotal / races.length : null,
    expectedHitRate: sampleCount ? expectedHits / sampleCount : null,
    actualHitRate: sampleCount ? actualHits / sampleCount : null,
    pricedRunners,
    valueSelections: {
      bets: selections.length,
      races: new Set(selections.map((selection) => selection.raceId)).size,
      expectedHitRate: selections.length ? selections.reduce((sum, selection) => sum + selection.probability, 0) / selections.length : null,
      actualHitRate: selections.length ? selections.filter((selection) => selection.placed).length / selections.length : null,
      flatStakeRoiPct: selections.length ? selections.reduce((sum, selection) => sum + (selection.placed ? selection.odds - 1 : -1), 0) / selections.length * 100 : null,
    },
  }
}

export function runPlaceCalibrationStudy(races: PlaceStudyRace[]) {
  const split = splitPlaceStudy(races)
  const strength = fitPlaceShrinkage(split.train)
  const validation = { raw: scorePlaceStudy(split.validation, 0), corrected: scorePlaceStudy(split.validation, strength) }
  const improves = (scores: typeof validation) => scores.raw.brier != null && scores.corrected.brier != null
    && scores.raw.logLoss != null && scores.corrected.logLoss != null
    && scores.corrected.brier < scores.raw.brier && scores.corrected.logLoss < scores.raw.logLoss
  const validationPassed = split.train.length >= 30 && split.validation.length >= 30 && improves(validation)
  const test = validationPassed ? { raw: scorePlaceStudy(split.test, 0), corrected: scorePlaceStudy(split.test, strength) } : null
  return {
    strength,
    days: split.days,
    trainingRaces: split.train.length,
    validation,
    validationPassed,
    test,
    testWithheld: !validationPassed,
    untouchedTestRaces: split.test.length,
    eligibleForProspectiveReview: test != null && split.test.length >= 30 && improves(test),
    productionChanged: false,
  }
}