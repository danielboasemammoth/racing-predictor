import type { PredictionPayload } from '@/lib/types'

export interface ActualRaceEntry {
  horse_id: string
  finishing_position: number | null
  finishing_time: number | null
}

export interface BacktestOutcome {
  actualPodium: string[]
  correctWinner: boolean
  correctPodium: boolean
  timeErrors: number[]
  accuracyScore: number
  winnerTop3: boolean
  podiumOverlap: number
  orderedTrifecta: boolean
  winnerBrierScore: number
  winnerLogLoss: number
}

export function evaluatePrediction(
  prediction: PredictionPayload,
  predictedTimes: Record<string, number>,
  entries: ActualRaceEntry[],
): BacktestOutcome | null {
  const finishers = entries
    .filter((entry) => entry.finishing_position !== null && entry.finishing_position > 0)
    .sort((left, right) => left.finishing_position! - right.finishing_position!)

  if (!finishers.length || !prediction.podium.length) return null

  const actualPodium = finishers.slice(0, 3).map((entry) => entry.horse_id)
  const predictedPodium = prediction.podium.slice(0, 3).map((horse) => horse.horse_id)
  const correctWinner = predictedPodium[0] === actualPodium[0]
  const correctPodium = actualPodium.length === 3
    && predictedPodium.length === 3
    && actualPodium.every((horseId) => predictedPodium.includes(horseId))
  const orderedTrifecta = actualPodium.length === 3
    && actualPodium.every((horseId, index) => predictedPodium[index] === horseId)
  const winnerTop3 = predictedPodium[0] ? actualPodium.includes(predictedPodium[0]) : false
  const podiumOverlap = actualPodium.length
    ? predictedPodium.filter((horseId) => actualPodium.includes(horseId)).length / actualPodium.length
    : 0
  const winnerId = actualPodium[0]
  const probabilityField = prediction.all_horses.length ? prediction.all_horses : prediction.podium
  const winnerProbability = probabilityField.find((horse) => horse.horse_id === winnerId)?.win_probability
    ?? probabilityField.find((horse) => horse.horse_id === winnerId)?.confidence
    ?? 0
  const winnerBrierScore = probabilityField.reduce((sum, horse) => {
    const probability = horse.win_probability ?? horse.confidence
    const outcome = horse.horse_id === winnerId ? 1 : 0
    return sum + (probability - outcome) ** 2
  }, 0) / Math.max(probabilityField.length, 1)
  const winnerLogLoss = -Math.log(Math.max(winnerProbability, 1e-9))
  const timeErrors = finishers.flatMap((entry) => {
    const predictedTime = predictedTimes[entry.horse_id]
    return entry.finishing_time !== null && predictedTime > 0
      ? [Math.abs(predictedTime - entry.finishing_time)]
      : []
  })

  return {
    actualPodium,
    correctWinner,
    correctPodium,
    timeErrors,
    accuracyScore: (Number(correctWinner) + Number(correctPodium)) / 2,
    winnerTop3,
    podiumOverlap,
    orderedTrifecta,
    winnerBrierScore,
    winnerLogLoss,
  }
}