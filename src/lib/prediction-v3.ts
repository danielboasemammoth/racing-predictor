import type { JsonValue, PredictedHorse, PredictionPayload, RaceEntryWithHorse } from '@/lib/types'
import { averageSectionalRating } from '@/lib/sectional-speed'

export interface PredictionModelConfig {
  version: string
  temperature: number
  weights: Omit<Features, 'historyStarts'>
}

export const MODEL_CONFIGS = {
  baseline: {
    version: 'v4-baseline',
    temperature: 1.8,
    weights: {
      recentForm: 2.2,
      contextualForm: 2.8,
      distanceSuitability: 1.1,
      conditionSuitability: 1.1,
      courseSuitability: 0.7,
      classMovement: 0.6,
      speedRating: 0,
      jockeyForm: 0.8,
      trainerForm: 0.8,
      partnershipForm: 0.6,
      barrierSuitability: 0.55,
      weightSuitability: 0.7,
      fitness: 0.65,
    },
  },
  contextual: {
    version: 'v4-context-form',
    temperature: 2.1,
    weights: {
      recentForm: 2.8,
      contextualForm: 3.6,
      distanceSuitability: 1.2,
      conditionSuitability: 0.8,
      courseSuitability: 0.6,
      classMovement: 0.8,
      speedRating: 0,
      jockeyForm: 1,
      trainerForm: 1.1,
      partnershipForm: 0.9,
      barrierSuitability: 0.25,
      weightSuitability: 0.9,
      fitness: 0.5,
    },
  },
  connections: {
    version: 'v4-connections',
    temperature: 2.2,
    weights: {
      recentForm: 2.2,
      contextualForm: 3.2,
      distanceSuitability: 0.9,
      conditionSuitability: 0.7,
      courseSuitability: 0.5,
      classMovement: 0.7,
      speedRating: 0,
      jockeyForm: 1.5,
      trainerForm: 1.7,
      partnershipForm: 1.6,
      barrierSuitability: 0.2,
      weightSuitability: 1,
      fitness: 0.45,
    },
  },
  optimized: {
    version: 'v4-optimized',
    temperature: 2.2,
    weights: {
      recentForm: 1.7,
      contextualForm: 2.6,
      distanceSuitability: 0.9,
      conditionSuitability: 0.7,
      courseSuitability: 0.5,
      classMovement: 0.7,
      speedRating: 0,
      jockeyForm: 1.5,
      trainerForm: 1.7,
      partnershipForm: 1.6,
      barrierSuitability: 0.2,
      weightSuitability: 1,
      fitness: 0.45,
    },
  },
  // Weights fitted via gradient descent on a conditional-logit objective over all completed
  // races (scripts/train-logit-weights.ts / train-logit-weights-kfold.ts), rather than
  // hand-guessed. Validated via a 5-fold walk-forward comparison against the hand-tuned configs
  // above: beat them on 3 of 5 folds with a better average objective (0.2672 vs 0.2654) - a real
  // but modest edge, not an overwhelming one. Tracked as its own model version rather than
  // replacing the production ensemble, so real accumulating accuracy data can confirm or deny
  // the edge before it's ever considered for promotion.
  trained: {
    version: 'v5-trained',
    temperature: 1,
    weights: {
      recentForm: 0.3223,
      contextualForm: 0.1989,
      distanceSuitability: 0.2447,
      conditionSuitability: 0.1944,
      courseSuitability: 0.1481,
      classMovement: 0.0333,
      speedRating: 0.0013,
      jockeyForm: 0.1775,
      trainerForm: 0.1571,
      partnershipForm: 0.1683,
      barrierSuitability: 0.0358,
      weightSuitability: 0.078,
      fitness: 0.0256,
    },
  },
} satisfies Record<string, PredictionModelConfig>

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
  /** Lengths vs Racing.com's own benchmark time for that track/distance/class - see src/lib/sectional-speed.ts. */
  standardTimeDifference?: number
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

export interface Features {
  recentForm: number
  contextualForm: number
  distanceSuitability: number
  conditionSuitability: number
  courseSuitability: number
  classMovement: number
  speedRating: number
  jockeyForm: number
  trainerForm: number
  partnershipForm: number
  barrierSuitability: number
  weightSuitability: number
  fitness: number
  historyStarts: number
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

export function resultScore(start: HistoricalStart) {
  if (!start.finishingPosition || start.fieldSize < 2) return 0
  const positionScore = clamp(1 - (start.finishingPosition - 1) / (start.fieldSize - 1))
  if (start.margin === undefined || start.finishingPosition === 1) return positionScore
  const marginScore = Math.exp(-Math.max(0, start.margin) / 5)
  return positionScore * 0.75 + marginScore * 0.25
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

function partnershipRate(starts: HistoricalStart[], jockey: string | undefined, trainer: string | undefined, target: RaceContext) {
  if (!jockey || !trainer) return 0.5
  const matching = starts.filter((start) => start.jockey === jockey && start.trainer === trainer && start.finishingPosition)
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

/**
 * Benchmarked-time speed rating (spec Phase 4), normalized to the same 0-1/0.5-neutral scale as
 * every other feature - +/-10 lengths vs the track/distance/class standard maps to +/-0.5.
 * Replaced the older normalizedSpeed() (raw distance/time with a track-condition fudge factor,
 * not actually comparable across different tracks), which is why speedRating's weight had been
 * left at 0 in every model config - validated via scripts/experiment-sectional-speed.ts and
 * scripts/tune-sectional-weight.ts before giving it a nonzero weight.
 */
function sectionalSpeedRating(recentStarts: HistoricalStart[]) {
  const rating = averageSectionalRating(recentStarts.map((start) => ({ standardTimeDifference: start.standardTimeDifference ?? null })))
  return rating === null ? 0.5 : clamp(0.5 + rating / 20)
}

function buildFeatures(
  entry: RaceEntryWithHorse,
  target: RaceContext,
  allHistory: HistoricalStart[],
  fieldAverageWeight: number | undefined,
) {
  const targetTime = new Date(target.raceDatetime).getTime()
  const availableHistory = allHistory.filter((start) => new Date(start.raceDatetime).getTime() < targetTime)
  const horseHistory = availableHistory
    .filter((start) => start.horseId === entry.horse_id)
    .sort((left, right) => right.raceDatetime.localeCompare(left.raceDatetime))
  const recentStarts = horseHistory.slice(0, 5)
  const weightTotal = recentStarts.reduce((sum, _, index) => sum + Math.exp(-index / 4), 0) || 1
  const recentForm = recentStarts.reduce((sum, start, index) => sum + resultScore(start) * Math.exp(-index / 4), 0) / weightTotal
  const contextualForm = recentStarts.reduce(
    (sum, start, index) => sum + resultScore(start) * contextualSimilarity(start, target) * Math.exp(-index / 4),
    0,
  ) / weightTotal
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
    speedRating: sectionalSpeedRating(recentStarts),
    jockeyForm: strikeRate(availableHistory, 'jockey', entry.jockey, target),
    trainerForm: strikeRate(availableHistory, 'trainer', entry.trainer, target),
    partnershipForm: partnershipRate(availableHistory, entry.jockey, entry.trainer, target),
    barrierSuitability: suitability(sameBarrierBand, () => true),
    weightSuitability: /bm\s*\d+/i.test(target.raceClass ?? '') && fieldAverageWeight !== undefined && entry.weight_carried !== undefined
      ? clamp(0.5 + (entry.weight_carried - fieldAverageWeight) * 0.08)
      : clamp(0.5 + (averageWeight - (entry.weight_carried ?? averageWeight)) * 0.04),
    fitness,
    historyStarts: horseHistory.length,
  }
  return { features, recentStarts }
}

function score(features: Features, weights: PredictionModelConfig['weights']) {
  return (features.recentForm - 0.5) * weights.recentForm
    + (features.contextualForm - 0.5) * weights.contextualForm
    + (features.distanceSuitability - 0.5) * weights.distanceSuitability
    + (features.conditionSuitability - 0.5) * weights.conditionSuitability
    + (features.courseSuitability - 0.5) * weights.courseSuitability
    + (features.classMovement - 0.5) * weights.classMovement
    + (features.speedRating - 0.5) * weights.speedRating
    + (features.jockeyForm - 0.5) * weights.jockeyForm
    + (features.trainerForm - 0.5) * weights.trainerForm
    + (features.partnershipForm - 0.5) * weights.partnershipForm
    + (features.barrierSuitability - 0.5) * weights.barrierSuitability
    + (features.weightSuitability - 0.5) * weights.weightSuitability
    + (features.fitness - 0.5) * weights.fitness
}

function placeProbabilities(scores: number[], temperature: number) {
  const calibratedScores = scores.map((value) => value / temperature)
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

export function predictContextualRace(
  input: ContextualPredictionInput,
  config: PredictionModelConfig = MODEL_CONFIGS.baseline,
): ContextualPredictionResult {
  const knownFieldWeights = input.entries.flatMap((entry) => entry.weight_carried !== undefined ? [entry.weight_carried] : [])
  const fieldAverageWeight = knownFieldWeights.length
    ? knownFieldWeights.reduce((sum, weight) => sum + weight, 0) / knownFieldWeights.length
    : undefined
  const ranked: RankedEntry[] = input.entries
    .filter((entry): entry is RaceEntryWithHorse & { horses: NonNullable<RaceEntryWithHorse['horses']> } => Boolean(entry.horses))
    .map((entry) => {
      const { features, recentStarts } = buildFeatures(entry, input.race, input.history, fieldAverageWeight)
      return {
        horseId: entry.horse_id,
        horseName: entry.horses.name,
        score: score(features, config.weights),
        features,
        recentStarts,
        predictedTime: undefined,
        odds: input.oddsByHorse?.[entry.horse_id] ?? {},
      }
    })
  const probabilities = placeProbabilities(ranked.map((entry) => entry.score), config.temperature)
  const scored = ranked.map((entry, index) => ({
    ...entry,
    winProbability: probabilities.win[index],
    top3Probability: probabilities.top3[index],
  })).sort((left, right) => right.winProbability - left.winProbability || left.horseName.localeCompare(right.horseName))

  const calibrationRows = scored.map((entry) => {
    const historyWeight = clamp((entry.features.historyStarts - 3) / 12, 0, 1)
    const baseRate = entry.features.historyStarts > 0
      ? clamp((entry.features.recentForm - 0.5) * 0.6 + 0.12)
      : 0.05
    const winProbability = entry.winProbability * (0.7 + historyWeight * 0.3) + baseRate * (1 - historyWeight) * 0.3
    return { ...entry, winProbability }
  })
  const calibratedTotal = calibrationRows.reduce((sum, entry) => sum + entry.winProbability, 0) || 1
  const calibrated = calibrationRows
    .map((entry) => ({ ...entry, winProbability: entry.winProbability / calibratedTotal }))
    .sort((left, right) => right.winProbability - left.winProbability || left.horseName.localeCompare(right.horseName))

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
