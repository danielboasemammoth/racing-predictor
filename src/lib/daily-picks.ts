import type { JsonValue, PredictedHorse, RaceWithPrediction } from '@/lib/types'
import { classifyRaceType } from '@/lib/reliability-analysis'
import { computeReliabilityScore, type CalibrationTable, type ReliabilityResult } from '@/lib/reliability-score'

export interface DailyPick {
  race: RaceWithPrediction
  horse: PredictedHorse
  winProbability: number
  top3Probability: number
  leadOverSecond: number
  historyStarts: number
  certaintyScore: number
  raceType: string
  reliability: ReliabilityResult | null
}

export interface DailyPicksFilterOptions {
  /** When provided, picks are ranked by Reliability Score instead of the simpler certaintyScore. */
  calibration?: CalibrationTable | null
  minReliability?: number
  maidenOnly?: boolean
}

export function melbourneDateKey(value: Date | string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

function objectValue(value: JsonValue | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function historyStarts(race: RaceWithPrediction, horseId: string) {
  const snapshot = objectValue(race.prediction?.predictions.feature_snapshots?.[horseId])
  const features = objectValue(snapshot?.features)
  return typeof features?.historyStarts === 'number' ? features.historyStarts : 0
}

export function candidatesForDate(races: RaceWithPrediction[], dateKey: string, options: DailyPicksFilterOptions = {}): DailyPick[] {
  const candidates = races.flatMap((race) => {
    if (!race.prediction) return []
    if (melbourneDateKey(race.race_datetime) !== dateKey) return []
    const horse = race.prediction.predictions.podium[0]
    if (!horse) return []

    const winProbability = horse.win_probability ?? horse.confidence
    const top3Probability = horse.top3_probability ?? Math.min(winProbability * 3, 1)
    const second = race.prediction.predictions.podium[1]
    const secondWinProbability = second?.win_probability ?? second?.confidence ?? 0
    const leadOverSecond = Math.max(0, winProbability - secondWinProbability)
    const starts = historyStarts(race, horse.horse_id)
    const evidenceScore = Math.min(starts / 5, 1)
    const separationScore = Math.min(leadOverSecond / 0.15, 1)
    const certaintyScore = winProbability * 0.5
      + top3Probability * 0.3
      + separationScore * 0.12
      + evidenceScore * 0.08

    const otherModels = (race.model_predictions ?? []).filter((model) => model.model_version !== race.prediction?.model_version)
    const agreeing = otherModels.filter((model) => model.predictions.podium[0]?.horse_id === horse.horse_id).length
    const reliability = options.calibration
      ? computeReliabilityScore({ probability: winProbability, gap: leadOverSecond, agreeing, totalBaseModels: otherModels.length }, options.calibration)
      : null

    return [{
      race,
      horse,
      winProbability,
      top3Probability,
      leadOverSecond,
      historyStarts: starts,
      certaintyScore,
      raceType: classifyRaceType(race.race_class),
      reliability,
    }]
  })

  const filtered = candidates.filter((pick) => {
    if (options.minReliability !== undefined && (pick.reliability?.score ?? -1) < options.minReliability) return false
    if (options.maidenOnly && pick.raceType !== 'maiden' && pick.raceType !== 'super-maiden') return false
    return true
  })

  // Reliability Score (when available) is a better-evidenced ranking than the simpler
  // certaintyScore, which only looks at this one prediction with no historical calibration.
  const rank = (pick: DailyPick) => pick.reliability ? pick.reliability.score : pick.certaintyScore * 100
  return filtered.sort((left, right) => rank(right) - rank(left))
}

export function getDailyPicks(races: RaceWithPrediction[], now = new Date(), limit = 3, options: DailyPicksFilterOptions = {}): DailyPick[] {
  return candidatesForDate(races, melbourneDateKey(now), options).slice(0, limit)
}

export function getTomorrowPicks(races: RaceWithPrediction[], now = new Date(), limit = 3, options: DailyPicksFilterOptions = {}): DailyPick[] {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return candidatesForDate(races, melbourneDateKey(tomorrow), options).slice(0, limit)
}
