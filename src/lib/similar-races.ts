/**
 * Similar Historical Races engine (spec section 24). Finds past races that resemble an
 * upcoming one and reports how the model actually performed in them. Uses tiered criteria
 * relaxation - starts strict, and only broadens the match when the strict tier doesn't have
 * enough races to be credible, so results are never based on an unreasonably tiny sample without
 * disclosing that trade-off via `criteriaUsed`.
 */
import { MIN_CREDIBLE_SAMPLE, summarizeBucket, distanceBand, fieldSizeBand, type BucketStats } from './reliability-analysis'

export interface HistoricalRaceFeatures {
  raceId: string
  correctWinner: boolean
  distanceM: number | null
  raceType: string
  fieldSize: number
  trackCondition: string | null
  barrierThird: 'inside' | 'middle' | 'outside' | null
  /** Model's own win probability for its predicted horse - needed to reconstruct historical Model Edge bands. */
  probability?: number
  /** Best recorded win price from Racing.com's own feed - NOT a confirmed TAB/Betfair price. */
  bestRecordedOdds?: number | null
}

export interface SimilarRaceQuery {
  distanceM: number | null
  raceType: string
  fieldSize: number
  trackCondition: string | null
  barrierThird: 'inside' | 'middle' | 'outside' | null
}

export interface SimilarRacesResult extends BucketStats {
  criteriaUsed: string[]
  evidenceConfidence: 'Low' | 'Medium' | 'High'
}

interface Tier {
  criteria: string[]
  matches: (query: SimilarRaceQuery, race: HistoricalRaceFeatures) => boolean
}

const TIERS: Tier[] = [
  {
    criteria: ['distance', 'race type', 'field size', 'barrier third', 'track condition'],
    matches: (q, r) => distanceBand(r.distanceM) === distanceBand(q.distanceM)
      && r.raceType === q.raceType
      && fieldSizeBand(r.fieldSize) === fieldSizeBand(q.fieldSize)
      && r.barrierThird === q.barrierThird
      && r.trackCondition === q.trackCondition,
  },
  {
    criteria: ['distance', 'race type', 'field size'],
    matches: (q, r) => distanceBand(r.distanceM) === distanceBand(q.distanceM)
      && r.raceType === q.raceType
      && fieldSizeBand(r.fieldSize) === fieldSizeBand(q.fieldSize),
  },
  {
    criteria: ['distance', 'race type'],
    matches: (q, r) => distanceBand(r.distanceM) === distanceBand(q.distanceM) && r.raceType === q.raceType,
  },
  {
    criteria: ['race type'],
    matches: (q, r) => r.raceType === q.raceType,
  },
  {
    criteria: ['all historical races'],
    matches: () => true,
  },
]

export function findSimilarRaces(query: SimilarRaceQuery, history: HistoricalRaceFeatures[]): SimilarRacesResult {
  const overallBaseline = history.length ? history.filter((r) => r.correctWinner).length / history.length : 0

  for (const tier of TIERS) {
    const matches = history.filter((race) => tier.matches(query, race))
    const isLastTier = tier === TIERS[TIERS.length - 1]
    if (matches.length >= MIN_CREDIBLE_SAMPLE || isLastTier) {
      const wins = matches.filter((race) => race.correctWinner).length
      const stats = summarizeBucket(tier.criteria.join(' + '), wins, matches.length, overallBaseline)
      return {
        ...stats,
        criteriaUsed: tier.criteria,
        evidenceConfidence: matches.length >= MIN_CREDIBLE_SAMPLE * 3 ? 'High' : matches.length >= MIN_CREDIBLE_SAMPLE ? 'Medium' : 'Low',
      }
    }
  }
  // TIERS always ends with a catch-all match-everything tier, so this is unreachable.
  throw new Error('findSimilarRaces: no tier matched')
}
