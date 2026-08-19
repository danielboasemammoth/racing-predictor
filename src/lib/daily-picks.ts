import type { JsonValue, PredictedHorse, RaceWithPrediction } from '@/lib/types'

export interface DailyPick {
  race: RaceWithPrediction
  horse: PredictedHorse
  winProbability: number
  top3Probability: number
  leadOverSecond: number
  historyStarts: number
  certaintyScore: number
}

function melbourneDateKey(value: Date | string) {
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

function candidatesForDate(races: RaceWithPrediction[], dateKey: string): DailyPick[] {
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

    return [{
      race,
      horse,
      winProbability,
      top3Probability,
      leadOverSecond,
      historyStarts: starts,
      certaintyScore,
    }]
  })
  const byCertainty = (left: DailyPick, right: DailyPick) => right.certaintyScore - left.certaintyScore
  return candidates.sort(byCertainty)
}

export function getDailyPicks(races: RaceWithPrediction[], now = new Date(), limit = 3): DailyPick[] {
  return candidatesForDate(races, melbourneDateKey(now)).slice(0, limit)
}

export function getTomorrowPicks(races: RaceWithPrediction[], now = new Date(), limit = 3): DailyPick[] {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return candidatesForDate(races, melbourneDateKey(tomorrow)).slice(0, limit)
}
