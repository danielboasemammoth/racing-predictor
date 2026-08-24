/**
 * Production Reliability Score (0-100). Deliberately conservative: only blends the three
 * signals (model probability, prediction gap, multi-model agreement) that showed
 * directionally-consistent lift between the discovery and holdout slices in
 * scripts/reliability-analysis.ts. Race type/field size/track/barrier/venue findings did not
 * reliably replicate out-of-sample yet and are intentionally excluded from production scoring
 * until they do (see spec section 38: discovery must be validated before promotion).
 *
 * The score is a sample-size-weighted average of each factor's empirically observed
 * (shrinkage-adjusted) historical strike rate, not the model's own self-reported probability -
 * it answers "how has the model actually performed in races like this one", per the spec's own
 * definition of reliability.
 */
import { agreementBand, predictionGapBand, probabilityBand, MIN_CREDIBLE_SAMPLE, type BucketStats } from './reliability-analysis'

export interface CalibrationTable {
  overallBaseline: number
  probability: BucketStats[]
  gap: BucketStats[]
  agreement: BucketStats[]
  /**
   * Observed min/max of the raw blended strike-rate estimate across historical races. Win
   * probabilities are inherently capped low (rarely above ~40%), so mapping the blended rate
   * straight onto 0-100 would make "Very Strong"/"Exceptional" unreachable - the spec explicitly
   * forbids a plain probability*100 score. Rescaling against the historically observed range
   * means the best historically-performing combinations of conditions reach the top of the
   * scale, and the worst reach the bottom, which is what "reliability" is meant to express.
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
}

export interface ReliabilityResult {
  score: number
  classification: ReliabilityClassification
  evidenceConfidence: EvidenceConfidence
  evidenceSampleSize: number
  factors: ReliabilityFactor[]
}

export function classifyReliability(score: number): ReliabilityClassification {
  if (score < 30) return 'Poor'
  if (score < 50) return 'Below Average'
  if (score < 65) return 'Average'
  if (score < 80) return 'Strong'
  if (score < 90) return 'Very Strong'
  return 'Exceptional'
}

function findBucket(buckets: BucketStats[], label: string) {
  return buckets.find((bucket) => bucket.label === label)
}

export function computeReliabilityScore(input: ReliabilityInput, calibration: CalibrationTable): ReliabilityResult {
  const candidates: Array<{ label: string; bucket: BucketStats | undefined }> = [
    { label: 'Model probability calibration', bucket: findBucket(calibration.probability, probabilityBand(input.probability)) },
    { label: 'Prediction separation (#1 vs #2)', bucket: findBucket(calibration.gap, predictionGapBand(input.gap)) },
    { label: 'Multi-model agreement', bucket: findBucket(calibration.agreement, agreementBand(input.agreeing, input.totalBaseModels)) },
  ]
  const factors = candidates.filter((c): c is { label: string; bucket: BucketStats } => Boolean(c.bucket))

  const totalWeight = factors.reduce((sum, factor) => sum + factor.bucket.n, 0)
  const weightedRate = totalWeight > 0
    ? factors.reduce((sum, factor) => sum + factor.bucket.shrunkStrikeRate * factor.bucket.n, 0) / totalWeight
    : calibration.overallBaseline

  const { min, max } = calibration.rawRateRange
  const score = max > min
    ? Math.round(Math.min(100, Math.max(0, ((weightedRate - min) / (max - min)) * 100)))
    : Math.round(Math.min(100, Math.max(0, weightedRate * 100)))
  const evidenceConfidence: EvidenceConfidence = totalWeight >= MIN_CREDIBLE_SAMPLE * 3
    ? 'High'
    : totalWeight >= MIN_CREDIBLE_SAMPLE
      ? 'Medium'
      : 'Low'

  return {
    score,
    classification: classifyReliability(score),
    evidenceConfidence,
    evidenceSampleSize: totalWeight,
    factors: factors.map((factor) => ({
      label: `${factor.label}: ${factor.bucket.label}`,
      sampleSize: factor.bucket.n,
      observedStrikeRate: factor.bucket.shrunkStrikeRate,
      liftVsBaseline: factor.bucket.lift,
    })),
  }
}
