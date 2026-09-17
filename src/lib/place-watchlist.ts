import { melbourneDateKey } from './daily-picks'
import type { PredictedHorse, RaceWithPrediction } from './types'

export interface PlaceWatch {
  race: RaceWithPrediction
  horse: PredictedHorse
  top3Probability: number
}

export function getPlaceWatchlist(races: RaceWithPrediction[], dateKey: string, now = new Date()): PlaceWatch[] {
  return races.flatMap((race) => {
    const prediction = race.prediction
    const start = Date.parse(race.race_datetime)
    if (!prediction || race.status !== 'upcoming' || !Number.isFinite(start) || start <= now.getTime()) return []
    if (melbourneDateKey(race.race_datetime) !== dateKey) return []
    const predictedAt = Date.parse(prediction.predicted_at)
    if (!Number.isFinite(predictedAt) || predictedAt > now.getTime() || predictedAt >= start) return []
    const horses = prediction.predictions.all_horses.length ? prediction.predictions.all_horses : prediction.predictions.podium
    const seen = new Set<string>()
    return horses.flatMap((horse) => {
      const probability = horse.top3_probability
      if (seen.has(horse.horse_id)) return []
      seen.add(horse.horse_id)
      if (probability === undefined || !Number.isFinite(probability) || probability < 0.5 || probability > 1) return []
      return [{ race, horse, top3Probability: probability }]
    })
  }).sort((left, right) => right.top3Probability - left.top3Probability
    || Date.parse(left.race.race_datetime) - Date.parse(right.race.race_datetime)
    || left.horse.horse_id.localeCompare(right.horse.horse_id))
}