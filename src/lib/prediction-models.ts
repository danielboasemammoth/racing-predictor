import type { RaceEntryWithHorse, PredictionPayload } from '@/lib/types'

export interface RawScoredEntry {
  horseId: string
  horseName: string
  predictedTime?: number
  score: number
  confidence: number
}

export interface ModelResult {
  name: string
  predictions: PredictionPayload
  confidence_scores: {
    overall: number
    winner: number
    podium: number
  }
  predicted_times: Record<string, number>
  rawScores: RawScoredEntry[]
}

function buildPredictionResult(name: string, scored: RawScoredEntry[]): ModelResult {
  const maxScore = Math.max(...scored.map(({ score }) => score), 0)
  const scoreTotal = scored.reduce((sum, { score }) => sum + Math.exp(score - maxScore), 0)

  const normalized = scored.map((entry) => ({
    ...entry,
    score: entry.score + 0.001,
    confidence: scoreTotal > 0 ? Math.exp(entry.score - maxScore) / scoreTotal : 0,
  }))

  const sorted = normalized.sort((left, right) => right.score - left.score || left.horseName.localeCompare(right.horseName))

  const allHorses = sorted.map((entry, index) => ({
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
    name,
    predictions: { podium, all_horses: allHorses },
    confidence_scores: {
      overall: winnerConfidence,
      winner: winnerConfidence,
      podium: podiumConfidence,
    },
    predicted_times: Object.fromEntries(
      sorted.flatMap((entry) => entry.predictedTime === undefined ? [] : [[entry.horseId, entry.predictedTime]]),
    ),
    rawScores: sorted,
  }
}

export function predictByForm(entries: RaceEntryWithHorse[]): ModelResult {
  const valid = entries.filter((entry): entry is RaceEntryWithHorse & { horses: NonNullable<RaceEntryWithHorse['horses']> } => Boolean(entry.horses))

  const scored = valid.map((entry) => {
    const horse = entry.horses
    let score = 0
    let confidence = 0.25

    if (horse.career_runs && horse.career_runs > 0) {
      const winRate = (horse.career_wins ?? 0) / horse.career_runs
      score += winRate * 4
      confidence += Math.min(winRate, 0.35)
    }

    if (horse.last_race_date) {
      const daysSince = (Date.now() - new Date(horse.last_race_date).getTime()) / 86_400_000
      if (daysSince >= 7 && daysSince <= 28) {
        score += 0.25
        confidence += 0.1
      }
      if (daysSince > 120) {
        score -= 0.2
      }
    }

    if (horse.best_time_this_distance) {
      score += 0.3
      confidence += 0.05
    }

    return {
      horseId: entry.horse_id,
      horseName: horse.name,
      predictedTime: horse.best_time_this_distance,
      score,
      confidence: Math.min(confidence, 0.6),
    }
  })

  return buildPredictionResult('form', scored)
}

export function predictByBarrier(entries: RaceEntryWithHorse[], trackCondition?: string): ModelResult {
  const valid = entries.filter((entry): entry is RaceEntryWithHorse & { horses: NonNullable<RaceEntryWithHorse['horses']> } => Boolean(entry.horses))

  const scored = valid.map((entry) => {
    const horse = entry.horses
    let score = 0
    let confidence = 0.2

    if (entry.barrier_number && entry.barrier_number <= 4) {
      score += 0.4
      confidence += 0.15
    }

    if (entry.barrier_number && entry.barrier_number >= 10 && valid.length > 10) {
      score -= 0.15
    }

    const condition = trackCondition?.toLowerCase() ?? ''
    if (condition.includes('heavy') && horse.heavy_form_rating) {
      score += horse.heavy_form_rating * 0.4
      confidence += 0.1
    } else if ((condition.includes('soft') || condition.includes('wet')) && horse.wet_form_rating) {
      score += horse.wet_form_rating * 0.4
      confidence += 0.1
    } else if (horse.dry_form_rating) {
      score += horse.dry_form_rating * 0.4
      confidence += 0.1
    }

    if (horse.best_time_this_distance) {
      score += 0.2
      confidence += 0.05
    }

    return {
      horseId: entry.horse_id,
      horseName: horse.name,
      predictedTime: horse.best_time_this_distance,
      score,
      confidence: Math.min(confidence, 0.6),
    }
  })

  return buildPredictionResult('barrier', scored)
}

export function predictByCondition(entries: RaceEntryWithHorse[], trackCondition?: string): ModelResult {
  const valid = entries.filter((entry): entry is RaceEntryWithHorse & { horses: NonNullable<RaceEntryWithHorse['horses']> } => Boolean(entry.horses))

  const scored = valid.map((entry) => {
    const horse = entry.horses
    let score = 0.1
    let confidence = 0.15

    const condition = trackCondition?.toLowerCase() ?? ''

    if (condition.includes('heavy') && horse.heavy_form_rating !== undefined) {
      score += horse.heavy_form_rating * 0.7
      confidence += 0.2
    } else if ((condition.includes('soft') || condition.includes('wet')) && horse.wet_form_rating !== undefined) {
      score += horse.wet_form_rating * 0.7
      confidence += 0.2
    } else if (horse.dry_form_rating !== undefined) {
      score += horse.dry_form_rating * 0.7
      confidence += 0.2
    }

    if (horse.career_runs && horse.career_runs > 0) {
      score += ((horse.career_wins ?? 0) / horse.career_runs) * 1.5
      confidence += 0.05
    }

    return {
      horseId: entry.horse_id,
      horseName: horse.name,
      predictedTime: horse.best_time_this_distance,
      score,
      confidence: Math.min(confidence, 0.6),
    }
  })

  return buildPredictionResult('condition', scored)
}

export function combineEnsemble(results: ModelResult[]): ModelResult {
  if (!results.length) {
    return {
      name: 'ensemble',
      predictions: { podium: [], all_horses: [] },
      confidence_scores: { overall: 0, winner: 0, podium: 0 },
      predicted_times: {},
      rawScores: [],
    }
  }

  const horseScores = new Map<string, number>()
  const horseConfidences = new Map<string, number>()
  const horseNames = new Map<string, string>()
  const horseTimes = new Map<string, number>()
  const modelCounts = new Map<string, number>()

  for (const result of results) {
    for (const entry of result.rawScores) {
      const currentScore = horseScores.get(entry.horseId) ?? 0
      horseScores.set(entry.horseId, currentScore + entry.score)

      const currentConf = horseConfidences.get(entry.horseId) ?? 0
      horseConfidences.set(entry.horseId, currentConf + entry.confidence)

      horseNames.set(entry.horseId, entry.horseName)

      if (entry.predictedTime) {
        const existing = horseTimes.get(entry.horseId)
        horseTimes.set(entry.horseId, existing ? (existing + entry.predictedTime) / 2 : entry.predictedTime)
      }

      const currentModels = modelCounts.get(entry.horseId) ?? 0
      modelCounts.set(entry.horseId, currentModels + 1)
    }
  }

  const allHorses = Array.from(horseScores.entries())
    .map(([horseId, score]) => ({
      horse_id: horseId,
      horse_name: horseNames.get(horseId) ?? 'Unknown',
      predicted_position: 0,
      score,
      ...(horseTimes.has(horseId) ? { predicted_time: horseTimes.get(horseId)! } : {}),
      confidence: horseConfidences.get(horseId)! / modelCounts.get(horseId)!,
    }))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.horse_name.localeCompare(b.horse_name))

  allHorses.forEach((horse, index) => {
    horse.predicted_position = index + 1
  })

  const podium = allHorses.slice(0, 3)
  const winnerConfidence = podium[0]?.confidence ?? 0
  const podiumConfidence = podium.reduce((sum, horse) => sum + horse.confidence, 0)

  return {
    name: 'ensemble',
    predictions: { podium, all_horses: allHorses },
    confidence_scores: {
      overall: winnerConfidence,
      winner: winnerConfidence,
      podium: podiumConfidence,
    },
    predicted_times: Object.fromEntries(
      allHorses.flatMap((entry) => entry.predicted_time === undefined ? [] : [[entry.horse_id, entry.predicted_time]]),
    ),
    rawScores: allHorses.map((entry) => ({
      horseId: entry.horse_id,
      horseName: entry.horse_name,
      predictedTime: entry.predicted_time,
      score: entry.score,
      confidence: entry.confidence,
    })),
  }
}
