import { describe, expect, it } from 'vitest'
import { deriveConfidence, sampleSizeFactor } from '@/lib/betting/confidence'

const STRONG_FACTORS = {
  dataCompleteness: 0.95,
  calibrationSampleSize: 200,
  modelAgreement: 0.9,
  historicalCalibration: 0.9,
  marketAgreement: 0.85,
  priceAgeSeconds: 20,
}

describe('confidence derivation', () => {
  it('produces VERY_HIGH only when every factor is strong and the price is fresh', () => {
    expect(deriveConfidence(STRONG_FACTORS).level).toBe('VERY_HIGH')
  })

  it('caps confidence at LOW when the TAB price is stale, regardless of other factors', () => {
    const result = deriveConfidence({ ...STRONG_FACTORS, priceAgeSeconds: 500 })
    expect(result.level).toBe('LOW')
    expect(result.cappedReason).toMatch(/stale/i)
  })

  it('caps confidence at LOW when data completeness is materially incomplete', () => {
    const result = deriveConfidence({ ...STRONG_FACTORS, dataCompleteness: 0.3 })
    expect(result.level).toBe('LOW')
  })

  it('caps confidence at MODERATE when the calibration sample is below the credible threshold', () => {
    const result = deriveConfidence({ ...STRONG_FACTORS, calibrationSampleSize: 5 })
    expect(result.level).toBe('MODERATE')
  })

  it('produces VERY_LOW when every factor is weak', () => {
    const result = deriveConfidence({
      dataCompleteness: 0.1,
      calibrationSampleSize: 0,
      modelAgreement: 0.1,
      historicalCalibration: 0.1,
      marketAgreement: 0.1,
      priceAgeSeconds: 10,
    })
    expect(result.level).toBe('VERY_LOW')
  })

  it('sample size factor approaches 1 at the credible threshold and 0 with no data', () => {
    expect(sampleSizeFactor(0)).toBe(0)
    expect(sampleSizeFactor(30)).toBe(1)
    expect(sampleSizeFactor(15)).toBeCloseTo(0.5, 5)
    expect(sampleSizeFactor(1000)).toBe(1) // never exceeds 1
  })
})
