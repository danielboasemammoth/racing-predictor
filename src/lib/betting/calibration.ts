/**
 * Model-validation calibration for the paper-betting engine: "expected wins vs actual wins" per
 * probability bucket, Brier score, log loss. Deliberately separate from src/lib/reliability-*.ts,
 * which calibrates the horse win-probability model itself - this module calibrates the value
 * (BET/WATCH/NO BET) engine's outcomes across BOTH horse and greyhound paper bets.
 */

export interface CalibrationSample {
  modelProbability: number
  won: boolean
}

export interface CalibrationBucket {
  bucketLabel: string
  bucketMin: number
  bucketMax: number
  sampleSize: number
  expectedWinRate: number
  actualWinRate: number | null
}

const MIN_CREDIBLE_SAMPLE = 30

/** Buckets samples into fixed-width probability bands (default 5pp) and compares expected vs actual. */
export function bucketCalibration(samples: CalibrationSample[], bucketWidth = 0.05): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = []
  for (let low = 0; low < 1; low += bucketWidth) {
    const high = Math.min(1, low + bucketWidth)
    const inBucket = samples.filter((s) => s.modelProbability >= low && s.modelProbability < high)
    const wins = inBucket.filter((s) => s.won).length
    buckets.push({
      bucketLabel: `${Math.round(low * 100)}-${Math.round(high * 100)}%`,
      bucketMin: low,
      bucketMax: high,
      sampleSize: inBucket.length,
      expectedWinRate: inBucket.length > 0 ? inBucket.reduce((sum, s) => sum + s.modelProbability, 0) / inBucket.length : (low + high) / 2,
      actualWinRate: inBucket.length > 0 ? wins / inBucket.length : null,
    })
  }
  return buckets
}

/** Only buckets with enough samples to be statistically meaningful - avoids over-reading noise. */
export function credibleBuckets(buckets: CalibrationBucket[]): CalibrationBucket[] {
  return buckets.filter((b) => b.sampleSize >= MIN_CREDIBLE_SAMPLE)
}

/** Mean squared error between predicted probability and the binary outcome. Lower is better; 0 is perfect. */
export function brierScore(samples: CalibrationSample[]): number | null {
  if (samples.length === 0) return null
  const sumSquaredError = samples.reduce((sum, s) => sum + (s.modelProbability - (s.won ? 1 : 0)) ** 2, 0)
  return sumSquaredError / samples.length
}

const EPSILON = 1e-9

/** Log loss (cross-entropy). Probabilities are clamped away from 0/1 to avoid -Infinity on a bad miss. */
export function logLoss(samples: CalibrationSample[]): number | null {
  if (samples.length === 0) return null
  const sum = samples.reduce((total, s) => {
    const p = Math.min(1 - EPSILON, Math.max(EPSILON, s.modelProbability))
    return total + (s.won ? Math.log(p) : Math.log(1 - p))
  }, 0)
  return -sum / samples.length
}
