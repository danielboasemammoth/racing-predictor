/**
 * Production Reliability Score (0-100). Rebuilt (audit spec Parts 1-5) around a SINGLE genuine
 * comparable-race cohort, using the exact tiered-relaxation pattern already proven in
 * similar-races.ts - never by summing sample sizes across the three overlapping factor
 * calibration tables (probability/gap/agreement), which is statistically invalid: the same
 * historical race appears in all three tables, so "237 + 186 + 1023 = 1446" was never a real
 * count of comparable races, just three overlapping counts added together. `evidenceSampleSize`
 * is now the size of ONE joint cohort (tiered: probability+gap+agreement, then probability+gap,
 * then probability+agreement, then probability alone, then the full historical baseline),
 * exactly like findSimilarRaces() - never a sum.
 *
 * Hard vetoes (spec Parts 2 & 5): classification can never claim Strong+ when the comparable
 * cohort's shrunk strike rate is at or below the historical baseline, or when evidence is
 * insufficient (n < MIN_CREDIBLE_SAMPLE) - regardless of where the raw rescaled score would
 * otherwise land. A confidence-interval upper bound still below baseline is treated as worse
 * again (capped at Below Average) - the cohort isn't just unproven, its own optimistic bound
 * still says "below average".
 */
import {
  agreementBand,
  predictionGapBand,
  probabilityBand,
  shrinkRate,
  summarizeBucket,
  wilsonInterval,
  MIN_CREDIBLE_SAMPLE,
  type BucketStats,
} from './reliability-analysis'
import type { HistoricalRaceFeatures } from './similar-races'

export interface CalibrationTable {
  overallBaseline: number
  /** Marginal (single-dimension) calibration, kept for informational per-factor display only - never summed into evidence. */
  probability: BucketStats[]
  gap: BucketStats[]
  agreement: BucketStats[]
  /**
   * Observed min/max of the joint comparable-cohort strike rate across historical races. Win
   * probabilities are inherently capped low (rarely above ~40%), so mapping the rate straight
   * onto 0-100 would make "Very Strong"/"Exceptional" unreachable - rescaling against the
   * historically observed range means the best historically-performing conditions reach the top
   * of the scale, and the worst reach the bottom, which is what "reliability" is meant to express.
   */
  rawRateRange: { min: number; max: number }
}

export interface ReliabilityInput {
  probability: number
  gap: number
  agreeing: number
  totalBaseModels: number
}

export type ReliabilityClassification = 'Poor' | 'Below Average' | 'Average' | 'Strong' | 'Very Strong' | 'Exceptional'
export type EvidenceConfidence = 'Low' | 'Medium' | 'High'

export interface ReliabilityFactor {
  label: string
  sampleSize: number
  observedStrikeRate: number
  liftVsBaseline: number
  /** True only when this factor's historical sample clears MIN_CREDIBLE_SAMPLE AND its CI excludes baseline - spec Parts 24-25: a near-zero or unproven lift must never be labelled "positive". */
  significant: boolean
}

export interface ReliabilityResult {
  score: number
  classification: ReliabilityClassification
  /** Set when a hard veto downgraded the classification below what the raw score alone would imply. */
  vetoReason: string | null
  evidenceConfidence: EvidenceConfidence
  evidenceSampleSize: number
  /** Which tier of the comparable cohort was actually used, e.g. ['probability','gap','agreement'] or ['all historical races']. */
  evidenceCriteriaUsed: string[]
  factors: ReliabilityFactor[]
}

export const CLASSIFICATION_RANK: Record<ReliabilityClassification, number> = {
  Poor: 0,
  'Below Average': 1,
  Average: 2,
  Strong: 3,
  'Very Strong': 4,
  Exceptional: 5,
}

export function classifyReliability(score: number): ReliabilityClassification {
  if (score < 30) return 'Poor'
  if (score < 50) return 'Below Average'
  if (score < 65) return 'Average'
  if (score < 80) return 'Strong'
  if (score < 90) return 'Very Strong'
  return 'Exceptional'
}

function capClassification(current: ReliabilityClassification, cap: ReliabilityClassification): ReliabilityClassification {
  return CLASSIFICATION_RANK[current] > CLASSIFICATION_RANK[cap] ? cap : current
}

export interface ComparableCohort extends BucketStats {
  criteriaUsed: string[]
}

interface CohortTier {
  criteria: string[]
  matches: (input: ReliabilityInput, row: HistoricalRaceFeatures) => boolean
}

const COHORT_TIERS: CohortTier[] = [
  {
    criteria: ['probability', 'gap', 'agreement'],
    matches: (i, r) =>
      r.probability != null && probabilityBand(r.probability) === probabilityBand(i.probability)
      && r.gap != null && predictionGapBand(r.gap) === predictionGapBand(i.gap)
      && r.totalBaseModels != null && agreementBand(r.agreeing ?? 0, r.totalBaseModels) === agreementBand(i.agreeing, i.totalBaseModels),
  },
  {
    criteria: ['probability', 'gap'],
    matches: (i, r) =>
      r.probability != null && probabilityBand(r.probability) === probabilityBand(i.probability)
      && r.gap != null && predictionGapBand(r.gap) === predictionGapBand(i.gap),
  },
  {
    criteria: ['probability', 'agreement'],
    matches: (i, r) =>
      r.probability != null && probabilityBand(r.probability) === probabilityBand(i.probability)
      && r.totalBaseModels != null && agreementBand(r.agreeing ?? 0, r.totalBaseModels) === agreementBand(i.agreeing, i.totalBaseModels),
  },
  {
    criteria: ['probability'],
    matches: (i, r) => r.probability != null && probabilityBand(r.probability) === probabilityBand(i.probability),
  },
  {
    criteria: ['all historical races'],
    matches: () => true,
  },
]

/** Builds the ONE comparable-race cohort for this prediction via tiered relaxation - never a sum of overlapping buckets. */
export function computeComparableCohort(input: ReliabilityInput, history: HistoricalRaceFeatures[]): ComparableCohort {
  const overallBaseline = history.length ? history.filter((r) => r.correctWinner).length / history.length : 0

  for (const tier of COHORT_TIERS) {
    const isLastTier = tier === COHORT_TIERS[COHORT_TIERS.length - 1]
    const matches = history.filter((row) => tier.matches(input, row))
    if (matches.length >= MIN_CREDIBLE_SAMPLE || isLastTier) {
      const wins = matches.filter((row) => row.correctWinner).length
      const stats = summarizeBucket(tier.criteria.join('+'), wins, matches.length, overallBaseline)
      return { ...stats, criteriaUsed: tier.criteria }
    }
  }
  // COHORT_TIERS always ends with a catch-all match-everything tier, so this is unreachable.
  throw new Error('computeComparableCohort: no tier matched')
}

function findBucket(buckets: BucketStats[], label: string) {
  return buckets.find((bucket) => bucket.label === label)
}

/** Per-dimension informational breakdown only - see ReliabilityFactor.significant before ever labelling one "positive". */
function marginalFactors(input: ReliabilityInput, calibration: CalibrationTable): ReliabilityFactor[] {
  const candidates: Array<{ label: string; bucket: BucketStats | undefined }> = [
    { label: 'Model probability calibration', bucket: findBucket(calibration.probability, probabilityBand(input.probability)) },
    { label: 'Prediction separation (#1 vs #2)', bucket: findBucket(calibration.gap, predictionGapBand(input.gap)) },
    { label: 'Multi-model agreement', bucket: findBucket(calibration.agreement, agreementBand(input.agreeing, input.totalBaseModels)) },
  ]
  return candidates
    .filter((c): c is { label: string; bucket: BucketStats } => Boolean(c.bucket))
    .map(({ label, bucket }) => ({
      label: `${label}: ${bucket.label}`,
      sampleSize: bucket.n,
      observedStrikeRate: bucket.shrunkStrikeRate,
      liftVsBaseline: bucket.lift,
      significant: bucket.significant,
    }))
}

export function computeReliabilityScore(input: ReliabilityInput, calibration: CalibrationTable, history: HistoricalRaceFeatures[]): ReliabilityResult {
  const cohort = computeComparableCohort(input, history)
  const weightedRate = cohort.n > 0 ? cohort.shrunkStrikeRate : calibration.overallBaseline

  const { min, max } = calibration.rawRateRange
  const score = max > min
    ? Math.round(Math.min(100, Math.max(0, ((weightedRate - min) / (max - min)) * 100)))
    : Math.round(Math.min(100, Math.max(0, weightedRate * 100)))

  const evidenceConfidence: EvidenceConfidence = cohort.n >= MIN_CREDIBLE_SAMPLE * 3
    ? 'High'
    : cohort.n >= MIN_CREDIBLE_SAMPLE
      ? 'Medium'
      : 'Low'

  let classification = classifyReliability(score)
  let vetoReason: string | null = null

  if (evidenceConfidence === 'Low' && CLASSIFICATION_RANK[classification] > CLASSIFICATION_RANK.Average) {
    classification = capClassification(classification, 'Average')
    vetoReason = `Insufficient evidence: only ${cohort.n} comparable historical races (need ${MIN_CREDIBLE_SAMPLE}+)`
  }
  if (cohort.n > 0 && cohort.shrunkStrikeRate <= cohort.baseline && CLASSIFICATION_RANK[classification] > CLASSIFICATION_RANK.Average) {
    classification = capClassification(classification, 'Average')
    vetoReason = `Comparable cohort strike rate (${(cohort.shrunkStrikeRate * 100).toFixed(1)}%) is at or below the historical baseline (${(cohort.baseline * 100).toFixed(1)}%)`
  }
  if (cohort.n > 0 && cohort.ciHigh < cohort.baseline && CLASSIFICATION_RANK[classification] > CLASSIFICATION_RANK['Below Average']) {
    classification = capClassification(classification, 'Below Average')
    vetoReason = `Even the optimistic end of the comparable cohort's confidence interval (${(cohort.ciHigh * 100).toFixed(1)}%) is below baseline`
  }

  return {
    score,
    classification,
    vetoReason,
    evidenceConfidence,
    evidenceSampleSize: cohort.n,
    evidenceCriteriaUsed: cohort.criteriaUsed,
    factors: marginalFactors(input, calibration),
  }
}

export interface ReliabilityCalibrationBand {
  label: string
  n: number
  wins: number
  strikeRate: number
  ciLow: number
  ciHigh: number
}

const RELIABILITY_BANDS = [
  { label: '90-100', min: 90, max: 101 },
  { label: '80-89', min: 80, max: 90 },
  { label: '70-79', min: 70, max: 80 },
  { label: '60-69', min: 60, max: 70 },
  { label: '50-59', min: 50, max: 60 },
  { label: '<50', min: 0, max: 50 },
]

/** Spec section 28: buckets historical races by their Reliability Score and reports the actual strike rate in each band - should read monotonically. */
export function reliabilityCalibrationBands(
  rows: Array<{ correctWinner: boolean; probability: number; gap: number; agreeing: number; totalBaseModels: number }>,
  calibration: CalibrationTable,
  history: HistoricalRaceFeatures[],
): ReliabilityCalibrationBand[] {
  const scored = rows.map((row) => ({
    correctWinner: row.correctWinner,
    score: computeReliabilityScore(
      { probability: row.probability, gap: row.gap, agreeing: row.agreeing, totalBaseModels: row.totalBaseModels },
      calibration,
      history,
    ).score,
  }))
  return RELIABILITY_BANDS.flatMap((band) => {
    const inBand = scored.filter((s) => s.score >= band.min && s.score < band.max)
    if (!inBand.length) return []
    const wins = inBand.filter((s) => s.correctWinner).length
    const [ciLow, ciHigh] = wilsonInterval(wins, inBand.length)
    return [{ label: band.label, n: inBand.length, wins, strikeRate: wins / inBand.length, ciLow, ciHigh }]
  })
}

// Re-exported for scripts/reliability-analysis.ts's rawRateRange computation, which needs to
// build the same joint-cohort-based rate distribution this module scores against.
export { shrinkRate }
