import type { PredictedHorse, PredictionPayload, RaceEntryWithHorse } from '@/lib/types'

export const MODEL_VERSION = 'v2-heuristic'

export interface PredictionResult {
  predictions: PredictionPayload
  confidence_scores: {
    overall: number
    winner: number
    podium: number
  }
  predicted_times: Record<string, number>
}

interface ScoredEntry {
  horseId: string
  horseName: string
  predictedTime?: number
  score: number
  confidence: number
}

function conditionRating(entry: RaceEntryWithHorse, trackCondition?: string) {
  const condition = trackCondition?.toLowerCase() ?? ''
  if (condition.includes('heavy')) return entry.horses?.heavy_form_rating
  if (condition.includes('soft') || condition.includes('wet')) return entry.horses?.wet_form_rating
  return entry.horses?.dry_form_rating
}

export function predictRace(entries: RaceEntryWithHorse[], trackCondition?: string): PredictionResult {
  const validEntries = entries.filter(
    (entry): entry is RaceEntryWithHorse & { horses: NonNullable<RaceEntryWithHorse['horses']> } => Boolean(entry.horses),
  )

  const rawScores = validEntries.map((entry) => {
    const horse = entry.horses
    let score = 0
    let knownFeatures = 0

    if (horse.career_runs && horse.career_runs > 0) {
      score += ((horse.career_wins ?? 0) / horse.career_runs) * 3
      score += ((horse.career_places ?? 0) / horse.career_runs) * 0.75
      knownFeatures += 2
    }

    if (horse.best_time_this_distance) knownFeatures += 1

    const formRating = conditionRating(entry, trackCondition)
    if (formRating !== undefined) {
      score += formRating * 0.5
      knownFeatures += 1
    }

    if (horse.last_race_date) {
      const daysSince = (Date.now() - new Date(horse.last_race_date).getTime()) / 86_400_000
      if (daysSince >= 7 && daysSince <= 42) score += 0.2
      if (daysSince > 120) score -= 0.15
      knownFeatures += 1
    }

    if (entry.barrier_number && entry.barrier_number <= Math.max(4, Math.ceil(validEntries.length / 3))) {
      score += 0.1
    }

    return {
      horseId: entry.horse_id,
      horseName: horse.name,
      predictedTime: horse.best_time_this_distance,
      score,
      knownFeatures,
    }
  })

  const maxScore = Math.max(...rawScores.map(({ score }) => score), 0)
  const scoreTotal = rawScores.reduce((sum, { score }) => sum + Math.exp(score - maxScore), 0)
  const scored: ScoredEntry[] = rawScores
    .map(({ knownFeatures, ...entry }) => ({
      ...entry,
      confidence: scoreTotal > 0 ? Math.exp(entry.score - maxScore) / scoreTotal : 0,
      score: entry.score + knownFeatures * 0.001,
    }))
    .sort((left, right) => right.score - left.score || left.horseName.localeCompare(right.horseName))

  const allHorses: PredictedHorse[] = scored.map((entry, index) => ({
    horse_id: entry.horseId,
    horse_name: entry.horseName,
    predicted_position: index + 1,
    ...(entry.predictedTime !== undefined ? { predicted_time: entry.predictedTime } : {}),
    confidence: entry.confidence,
  }))
  const podium = allHorses.slice(0, 3)
  const winnerConfidence = podium[0]?.confidence ?? 0
  const podiumConfidence = podium.reduce((sum, horse) => sum + horse.confidence, 0)

  return {
    predictions: { podium, all_horses: allHorses },
    confidence_scores: {
      overall: winnerConfidence,
      winner: winnerConfidence,
      podium: podiumConfidence,
    },
    predicted_times: Object.fromEntries(
      scored.flatMap((entry) => entry.predictedTime === undefined ? [] : [[entry.horseId, entry.predictedTime]]),
    ),
  }
}