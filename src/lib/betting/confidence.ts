/**
 * Confidence must come from measurable factors, never an invented percentage (product spec).
 * Every factor is normalised to 0-1 by the caller (or via the helpers below) before scoring.
 */

export type ConfidenceLevel = 'VERY_LOW' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'

export interface ConfidenceFactors {
  /** 0-1: fraction of expected features actually present for this runner/race. */
  dataCompleteness: number
  /** Sample size backing the model's calibration for this probability band (raw count, not 0-1). */
  calibrationSampleSize: number
  /** 0-1: agreement between multiple model variants/ensembles on this runner, if applicable. */
  modelAgreement: number
  /** 0-1: how well-calibrated the model has historically been (e.g. 1 - abs(expected-actual)/expected). */
  historicalCalibration: number
  /** 0-1: how much the model's view agrees with the market's no-vig probability (1 = identical). */
  marketAgreement: number
  /** Age of the TAB price used, in seconds. */
  priceAgeSeconds: number
}

export interface ConfidenceResult {
  level: ConfidenceLevel
  score: number
  cappedReason: string | null
}

const MIN_CREDIBLE_SAMPLE = 30
const STALE_PRICE_SECONDS = 120

/** Sample-size factor: 0 at n=0, approaches 1 as n passes MIN_CREDIBLE_SAMPLE. */
export function sampleSizeFactor(n: number): number {
  return Math.min(1, n / MIN_CREDIBLE_SAMPLE)
}

const WEIGHTS = {
  dataCompleteness: 0.15,
  sampleSize: 0.15,
  modelAgreement: 0.15,
  historicalCalibration: 0.3,
  marketAgreement: 0.25,
}

function levelFromScore(score: number): ConfidenceLevel {
  if (score < 0.2) return 'VERY_LOW'
  if (score < 0.4) return 'LOW'
  if (score < 0.6) return 'MODERATE'
  if (score < 0.8) return 'HIGH'
  return 'VERY_HIGH'
}

const LEVEL_RANK: Record<ConfidenceLevel, number> = { VERY_LOW: 0, LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4 }

function capAtMost(level: ConfidenceLevel, cap: ConfidenceLevel): ConfidenceLevel {
  return LEVEL_RANK[level] > LEVEL_RANK[cap] ? cap : level
}

/**
 * Deliberately conservative: stale prices or materially incomplete data cap the result at LOW
 * regardless of how strong the other factors look, rather than averaging the weakness away.
 */
export function deriveConfidence(factors: ConfidenceFactors): ConfidenceResult {
  const sampleFactor = sampleSizeFactor(factors.calibrationSampleSize)
  const score =
    factors.dataCompleteness * WEIGHTS.dataCompleteness +
    sampleFactor * WEIGHTS.sampleSize +
    factors.modelAgreement * WEIGHTS.modelAgreement +
    factors.historicalCalibration * WEIGHTS.historicalCalibration +
    factors.marketAgreement * WEIGHTS.marketAgreement

  let level = levelFromScore(score)
  let cappedReason: string | null = null

  if (factors.priceAgeSeconds > STALE_PRICE_SECONDS) {
    level = capAtMost(level, 'LOW')
    cappedReason = `TAB price is ${Math.round(factors.priceAgeSeconds)}s old (stale threshold ${STALE_PRICE_SECONDS}s)`
  }
  if (factors.dataCompleteness < 0.5) {
    level = capAtMost(level, 'LOW')
    cappedReason = cappedReason
      ? `${cappedReason}; data completeness ${(factors.dataCompleteness * 100).toFixed(0)}%`
      : `Data completeness only ${(factors.dataCompleteness * 100).toFixed(0)}%`
  }
  if (factors.calibrationSampleSize < MIN_CREDIBLE_SAMPLE) {
    level = capAtMost(level, 'MODERATE')
  }

  return { level, score, cappedReason }
}
