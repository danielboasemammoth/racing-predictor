import type { JsonValue, PredictedHorse, RaceWithPrediction } from '@/lib/types'
import { classifyRaceType } from '@/lib/reliability-analysis'
import { computeReliabilityScore, CLASSIFICATION_RANK, type CalibrationTable, type ReliabilityResult } from '@/lib/reliability-score'
import type { HistoricalRaceFeatures } from '@/lib/similar-races'

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
  /** When provided (with history), picks are ranked by Reliability Score and qualification-gated instead of the simpler certaintyScore. */
  calibration?: CalibrationTable | null
  history?: HistoricalRaceFeatures[] | null
  minReliability?: number
  maidenOnly?: boolean
  /** Escape hatch for callers that want the raw candidate list without the default qualification gate (e.g. an admin/debug view). Never set true for the public conservative shortlist. */
  skipQualificationGate?: boolean
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
      ? computeReliabilityScore({ probability: winProbability, gap: leadOverSecond, agreeing, totalBaseModels: otherModels.length }, options.calibration, options.history ?? [])
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
    // Default qualification gate (spec Parts 20-21): a conservative/high-conviction shortlist must
    // be allowed to contain ZERO picks rather than always filling with the top N regardless of
    // quality. Requires reliability to have been computed, no active hard veto (reliability-score.ts
    // caps classification whenever the comparable cohort is at/below baseline or evidence is thin),
    // and at least an 'Average' classification. Opt-out only for non-shortlist/debug callers.
    if (!options.skipQualificationGate) {
      if (!pick.reliability) return false
      if (pick.reliability.vetoReason !== null) return false
      if (CLASSIFICATION_RANK[pick.reliability.classification] < CLASSIFICATION_RANK.Average) return false
    }
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
