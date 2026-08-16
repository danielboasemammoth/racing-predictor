import type { JsonValue, PredictedHorse, PredictionPayload, RaceEntryWithHorse } from '@/lib/types'
import { drawBiasScore } from '@/lib/victoria-draw-bias'

export const CONTEXTUAL_MODEL_VERSION = 'v3.1-contextual-ranking'
const PROBABILITY_TEMPERATURE = 1.8

export interface RaceContext {
  id: string
  racecourseId: string
  raceDatetime: string
  distanceM?: number
  trackCondition?: string
  raceClass?: string
}

export interface HistoricalStart {
  raceId: string
  horseId: string
  racecourseId: string
  raceDatetime: string
  distanceM?: number
  trackCondition?: string
  raceClass?: string
  finishingPosition?: number
  fieldSize: number
  finishingTime?: number
  margin?: number
  barrier?: number
  weight?: number
  jockey?: string
  trainer?: string
}

export interface EntryOdds {
  win?: number
  place?: number
}

export interface ContextualPredictionInput {
  race: RaceContext
  entries: RaceEntryWithHorse[]
  history: HistoricalStart[]
  oddsByHorse?: Record<string, EntryOdds>
  fieldSize?: number
}

export interface ContextualPredictionResult {
  predictions: PredictionPayload
  confidence_scores: { overall: number; winner: number; podium: number }
  predicted_times: Record<string, number>
}

interface Features {
  recentForm: number
  contextualForm: number
  distanceSuitability: number
  conditionSuitability: number
  courseSuitability: number
  classMovement: number
  speedRating: number
  jockeyForm: number
  trainerForm: number
  barrierSuitability: number
  weightSuitability: number
  fitness: number
  historyStarts: number
  drawBias: number
}

interface RankedEntry {
  horseId: string
  horseName: string
  score: number
  features: Features
  recentStarts: HistoricalStart[]
  predictedTime?: number
  odds: EntryOdds
}

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value))

function conditionGroup(condition?: string) {
  const value = condition?.toLowerCase() ?? ''
  if (value.includes('heavy')) return 'heavy'
  if (value.includes('soft') || value.includes('wet')) return 'soft'
  if (value.includes('synthetic')) return 'synthetic'
  if (value.includes('good') || value.includes('firm') || value.includes('dry')) return 'dry'
  return 'unknown'
}

function classRating(value?: string) {
  const raceClass = value?.toLowerCase() ?? ''
  if (/group\s*1|\bg1\b/.test(raceClass)) return 10
  if (/group\s*2|\bg2\b/.test(raceClass)) return 9
  if (/group\s*3|\bg3\b/.test(raceClass)) return 8
  if (raceClass.includes('listed')) return 7
  const benchmark = raceClass.match(/bm\s*(\d+)/)?.[1]
  if (benchmark) return clamp((Number(benchmark) - 50) / 10, 1, 6)
  if (raceClass.includes('open')) return 6
  if (raceClass.includes('maiden') || raceClass.includes('mdn')) return 1
  return 3
}

function resultScore(start: HistoricalStart) {
  if (!start.finishingPosition || start.fieldSize < 2) return 0
  return clamp(1 - (start.finishingPosition - 1) / (start.fieldSize - 1))
}

function contextualSimilarity(start: HistoricalStart, target: RaceContext) {
  const distance = start.distanceM && target.distanceM
    ? Math.exp(-Math.abs(start.distanceM - target.distanceM) / 500)
    : 0.5
  const condition = conditionGroup(start.trackCondition) === conditionGroup(target.trackCondition) ? 1 : 0.35
  const raceClass = Math.exp(-Math.abs(classRating(start.raceClass) - classRating(target.raceClass)) / 2)
  const course = start.racecourseId === target.racecourseId ? 1 : 0.4
  return distance * 0.35 + condition * 0.25 + raceClass * 0.25 + course * 0.15
}

function strikeRate(
  starts: HistoricalStart[],
  key: 'jockey' | 'trainer',
  value: string | undefined,
  target: RaceContext,
) {
  if (!value) return 0.5
  const matching = starts.filter((start) => start[key] === value && start.finishingPosition)
  if (!matching.length) return 0.5
  const targetTime = new Date(target.raceDatetime).getTime()
  const weighted = matching.map((start) => ({
    placed: start.finishingPosition! <= 3 ? 1 : 0,
    weight: contextualSimilarity(start, target)
      * Math.exp(-(targetTime - new Date(start.raceDatetime).getTime()) / (180 * 86_400_000)),
  }))
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
  return (weighted.reduce((sum, item) => sum + item.placed * item.weight, 0) + 0.75) / (totalWeight + 1.5)
}

function suitability(starts: HistoricalStart[], predicate: (start: HistoricalStart) => boolean) {
  const matching = starts.filter((start) => predicate(start) && start.finishingPosition)
  if (!matching.length) return 0.5
  return matching.reduce((sum, start) => sum + resultScore(start), 0) / matching.length
}

function normalizedSpeed(starts: HistoricalStart[]) {
  const speeds = starts.flatMap((start) => start.finishingTime && start.distanceM
    ? [(start.distanceM / start.finishingTime) * (
        conditionGroup(start.trackCondition) === 'heavy' ? 1.06
          : conditionGroup(start.trackCondition) === 'soft' ? 1.03
            : 1
      )]
    : [])
  if (!speeds.length) return 0.5
  return clamp((speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length - 12) / 6)
}

function buildFeatures(entry: RaceEntryWithHorse, target: RaceContext, allHistory: HistoricalStart[]) {
  const targetTime = new Date(target.raceDatetime).getTime()
  const availableHistory = allHistory.filter((start) => new Date(start.raceDatetime).getTime() < targetTime)
  const horseHistory = availableHistory
    .filter((start) => start.horseId === entry.horse_id)
    .sort((left, right) => right.raceDatetime.localeCompare(left.raceDatetime))
  const recentStarts = horseHistory.slice(0, 5)
  const weights = [1, 0.85, 0.7, 0.55, 0.4]
  const weightTotal = recentStarts.reduce((sum, _, index) => sum + weights[index], 0) || 1
  const recentForm = recentStarts.reduce((sum, start, index) => sum + resultScore(start) * Math.exp(-index / 4), 0)
  const contextualForm = recentStarts.reduce(
    (sum, start, index) => sum + resultScore(start) * contextualSimilarity(start, target) * Math.exp(-index / 4),
    0,
  )
  const targetDistance = target.distanceM ?? 0
  const lastStart = recentStarts[0]
  const knownWeights = horseHistory.flatMap((start) => start.weight ? [start.weight] : [])
  const averageWeight = knownWeights.length
    ? knownWeights.reduce((sum, weight) => sum + weight, 0) / knownWeights.length
    : entry.weight_carried ?? 0
  const daysSince = lastStart ? (targetTime - new Date(lastStart.raceDatetime).getTime()) / 86_400_000 : 60
  const fitness = daysSince <= 14 ? 1
    : daysSince <= 35 ? 0.95
      : daysSince <= 60 ? 0.85
        : daysSince <= 90 ? 0.7
          : 0.4
  const courseDistance = availableHistory.filter((start) =>
    start.racecourseId === target.racecourseId
    && Math.abs((start.distanceM ?? targetDistance) - targetDistance) <= 200,
  )
  const sameBarrierBand = courseDistance.filter((start) =>
    start.barrier && entry.barrier_number
    && (start.barrier <= 4) === (entry.barrier_number <= 4),
  )
  const distanceBand = horseHistory.filter((start) =>
    start.distanceM !== undefined && target.distanceM !== undefined
    && Math.abs(start.distanceM - target.distanceM) <= 200,
  )

  const features: Features = {
    recentForm: recentStarts.length ? recentForm : 0.5,
    contextualForm: recentStarts.length ? contextualForm : 0.5,
    distanceSuitability: suitability(distanceBand, () => true),
    conditionSuitability: suitability(horseHistory, (start) => conditionGroup(start.trackCondition) === conditionGroup(target.trackCondition)),
    courseSuitability: suitability(horseHistory, (start) => start.racecourseId === target.racecourseId),
    classMovement: lastStart ? clamp(0.5 + (classRating(lastStart.raceClass) - classRating(target.raceClass)) * 0.08) : 0.5,
    speedRating: normalizedSpeed(recentStarts),
    jockeyForm: strikeRate(availableHistory, 'jockey', entry.jockey, target),
    trainerForm: strikeRate(availableHistory, 'trainer', entry.trainer, target),
    barrierSuitability: suitability(sameBarrierBand, () => true),
    weightSuitability: clamp(0.5 + (averageWeight - (entry.weight_carried ?? averageWeight)) * 0.12),
    fitness,
    historyStarts: horseHistory.length,
    drawBias: drawBiasScore(target.racecourseId, entry.barrier_number),
  }
  return { features, recentStarts }
}

function score(features: Features, fieldSize = 10) {
  const fieldSizeAdjustment = Math.log(fieldSize) * 0.08
  return (features.recentForm - 0.5) * 2.2
    + (features.contextualForm - 0.5) * 2.8
    + (features.distanceSuitability - 0.5) * 1.1
    + (features.conditionSuitability - 0.5) * 1.1
    + (features.courseSuitability - 0.5) * 0.7
    + (features.classMovement - 0.5) * 0.6
    + (features.speedRating - 0.5) * 1.2
    + (features.jockeyForm - 0.5) * 0.8
    + (features.trainerForm - 0.5) * 0.8
    + (features.barrierSuitability - 0.5) * 0.55
    + (features.weightSuitability - 0.5) * 0.7
    + (features.fitness - 0.5) * 0.65
    + (features.drawBias - 0.5) * 0.5
    + fieldSizeAdjustment
}

function placeProbabilities(scores: number[]) {
  const calibratedScores = scores.map((value) => value / PROBABILITY_TEMPERATURE)
  const maximum = Math.max(...calibratedScores, 0)
  const strengths = calibratedScores.map((value) => Math.exp(value - maximum))
  const total = strengths.reduce((sum, strength) => sum + strength, 0)
  const win = strengths.map((strength) => strength / total)
  const top3 = strengths.map(() => 0)
  for (let first = 0; first < strengths.length; first += 1) {
    top3[first] += win[first]
    for (let second = 0; second < strengths.length; second += 1) {
      if (second === first) continue
      const secondProbability = win[first] * strengths[second] / (total - strengths[first])
      top3[second] += secondProbability
      for (let third = 0; third < strengths.length; third += 1) {
        if (third === first || third === second) continue
        top3[third] += secondProbability * strengths[third] / (total - strengths[first] - strengths[second])
      }
    }
  }
  return { win, top3: top3.map((value) => clamp(value)) }
}

export function predictContextualRace(input: ContextualPredictionInput): ContextualPredictionResult {
  const ranked: RankedEntry[] = input.entries
    .filter((entry): entry is RaceEntryWithHorse & { horses: NonNullable<RaceEntryWithHorse['horses']> } => Boolean(entry.horses))
    .map((entry) => {
      const { features, recentStarts } = buildFeatures(entry, input.race, input.history)
      const timedStarts = recentStarts.filter((start) => start.finishingTime && start.distanceM)
      const predictedTime = input.race.distanceM && timedStarts.length
        ? timedStarts.reduce((sum, start) => sum + input.race.distanceM! / (start.distanceM! / start.finishingTime!), 0) / timedStarts.length
        : undefined
      return {
        horseId: entry.horse_id,
        horseName: entry.horses.name,
        score: score(features, input.fieldSize),
        features,
        recentStarts,
        predictedTime,
        odds: input.oddsByHorse?.[entry.horse_id] ?? {},
      }
    })
  const probabilities = placeProbabilities(ranked.map((entry) => entry.score))
  const scored = ranked.map((entry, index) => ({
    ...entry,
    winProbability: probabilities.win[index],
    top3Probability: probabilities.top3[index],
  })).sort((left, right) => right.winProbability - left.winProbability || left.horseName.localeCompare(right.horseName))

  const calibrated = scored.map((entry) => {
    const historyWeight = clamp((entry.features.historyStarts - 3) / 12, 0, 1)
    const baseRate = entry.features.historyStarts > 0
      ? clamp((entry.features.recentForm - 0.5) * 0.6 + 0.12)
      : 0.05
    const winProbability = entry.winProbability * (0.7 + historyWeight * 0.3) + baseRate * (1 - historyWeight) * 0.3
    const top3Probability = entry.top3Probability * (0.7 + historyWeight * 0.3) + baseRate * 3 * (1 - historyWeight) * 0.3
    return { ...entry, winProbability, top3Probability: clamp(top3Probability) }
  })

  const allHorses: PredictedHorse[] = calibrated.map((entry, index) => {
    const winEdge = entry.odds.win ? entry.winProbability * entry.odds.win - 1 : undefined
    const placeEdge = entry.odds.place ? entry.top3Probability * entry.odds.place - 1 : undefined
    const bestEdge = Math.max(winEdge ?? -1, placeEdge ?? -1)
    return {
      horse_id: entry.horseId,
      horse_name: entry.horseName,
      predicted_position: index + 1,
      ...(entry.predictedTime ? { predicted_time: entry.predictedTime } : {}),
      confidence: entry.winProbability,
      win_probability: entry.winProbability,
      top3_probability: entry.top3Probability,
      ...(entry.odds.win ? { win_odds: entry.odds.win, win_return_10: entry.odds.win * 10, win_value_edge: winEdge } : {}),
      ...(entry.odds.place ? { place_odds: entry.odds.place, place_return_10: entry.odds.place * 10, place_value_edge: placeEdge } : {}),
      value_rating: bestEdge >= 0.2 ? 'strong' : bestEdge > 0 ? 'positive' : 'neutral',
    }
  })
  const podium = allHorses.slice(0, 3)
  const winner = podium[0]?.win_probability ?? 0
  const secondStrength = podium[1]?.win_probability ?? 0
  const thirdStrength = podium[2]?.win_probability ?? 0
  const second = winner < 1 ? winner * secondStrength / (1 - winner) : 0
  const trifectaProbability = winner + secondStrength < 1
    ? second * thirdStrength / (1 - winner - secondStrength)
    : 0
  const valueOpportunities = allHorses.flatMap((horse) => [
    ...(horse.win_odds && (horse.win_probability ?? 0) >= 0.12 && (horse.win_value_edge ?? 0) > 0
      ? [{ horse_id: horse.horse_id, horse_name: horse.horse_name, market: 'win' as const, probability: horse.win_probability ?? 0, odds: horse.win_odds, return_10: horse.win_return_10!, value_edge: horse.win_value_edge! }]
      : []),
    ...(horse.place_odds && (horse.top3_probability ?? 0) >= 0.35 && (horse.place_value_edge ?? 0) > 0
      ? [{ horse_id: horse.horse_id, horse_name: horse.horse_name, market: 'place' as const, probability: horse.top3_probability ?? 0, odds: horse.place_odds, return_10: horse.place_return_10!, value_edge: horse.place_value_edge! }]
      : []),
  ]).sort((left, right) => right.value_edge - left.value_edge)
  const featureSnapshots = Object.fromEntries(calibrated.map((entry) => [entry.horseId, {
    features: Object.fromEntries(Object.entries(entry.features)),
    recent_starts: entry.recentStarts.map((start) => ({
      race_id: start.raceId,
      date: start.raceDatetime,
      position: start.finishingPosition ?? null,
      field_size: start.fieldSize,
      distance_m: start.distanceM ?? null,
      condition: start.trackCondition ?? null,
      class: start.raceClass ?? null,
      course_match: start.racecourseId === input.race.racecourseId,
      contextual_similarity: contextualSimilarity(start, input.race),
    })),
  } satisfies JsonValue]))

  return {
    predictions: {
      podium,
      all_horses: allHorses,
      trifecta: {
        horse_ids: podium.map((horse) => horse.horse_id),
        horse_names: podium.map((horse) => horse.horse_name),
        probability: trifectaProbability,
        fair_return_10: trifectaProbability > 0 ? 10 / trifectaProbability : 0,
        likelihood: trifectaProbability >= 0.05 ? 'high' : trifectaProbability >= 0.02 ? 'medium' : 'low',
        notable_value: trifectaProbability >= 0.02 && 10 / trifectaProbability >= 100,
      },
      value_opportunities: valueOpportunities.slice(0, 5),
      feature_snapshots: featureSnapshots,
    },
    confidence_scores: {
      overall: winner,
      winner,
      podium: podium.reduce((sum, horse) => sum + (horse.top3_probability ?? 0), 0) / Math.max(podium.length, 1),
    },
    predicted_times: Object.fromEntries(scored.flatMap((entry) => entry.predictedTime ? [[entry.horseId, entry.predictedTime]] : [])),
  }
}
