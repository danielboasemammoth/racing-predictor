import { describe, expect, it } from 'vitest'
import { brierScore, bucketCalibration, credibleBuckets, logLoss } from '@/lib/betting/calibration'

describe('calibration', () => {
  it('buckets samples by probability band and computes expected vs actual win rate', () => {
    const samples = [
      { modelProbability: 0.22, won: true },
      { modelProbability: 0.24, won: false },
      { modelProbability: 0.21, won: false },
      { modelProbability: 0.23, won: false },
    ]
    const buckets = bucketCalibration(samples)
    const band = buckets.find((b) => b.bucketLabel === '20-25%')
    expect(band).toBeDefined()
    expect(band!.sampleSize).toBe(4)
    expect(band!.actualWinRate).toBeCloseTo(0.25, 5)
    expect(band!.expectedWinRate).toBeCloseTo(0.225, 5)
  })

  it('reports null actual win rate for an empty bucket rather than 0', () => {
    const buckets = bucketCalibration([{ modelProbability: 0.9, won: true }])
    const empty = buckets.find((b) => b.bucketLabel === '0-5%')
    expect(empty!.sampleSize).toBe(0)
    expect(empty!.actualWinRate).toBeNull()
  })

  it('filters out buckets below the credible sample size', () => {
    const samples = Array.from({ length: 10 }, () => ({ modelProbability: 0.5, won: true }))
    expect(credibleBuckets(bucketCalibration(samples))).toEqual([])
  })

  it('keeps buckets that reach the credible sample size', () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({ modelProbability: 0.5, won: i % 2 === 0 }))
    const credible = credibleBuckets(bucketCalibration(samples))
    expect(credible.length).toBe(1)
    expect(credible[0].sampleSize).toBe(30)
  })

  it('computes a perfect Brier score of 0 for perfect predictions', () => {
    expect(brierScore([{ modelProbability: 1, won: true }, { modelProbability: 0, won: false }])).toBe(0)
  })

  it('computes a worst-case Brier score of 1 for confidently wrong predictions', () => {
    expect(brierScore([{ modelProbability: 1, won: false }])).toBe(1)
  })

  it('returns null Brier/log loss for no samples', () => {
    expect(brierScore([])).toBeNull()
    expect(logLoss([])).toBeNull()
  })

  it('computes near-zero log loss for confident correct predictions', () => {
    const loss = logLoss([{ modelProbability: 0.99, won: true }])
    expect(loss).toBeGreaterThanOrEqual(0)
    expect(loss).toBeLessThan(0.02)
  })

  it('computes a large but finite log loss for a confidently wrong prediction', () => {
    const loss = logLoss([{ modelProbability: 0.99, won: false }])
    expect(loss).toBeGreaterThan(4)
    expect(Number.isFinite(loss)).toBe(true)
  })
})
