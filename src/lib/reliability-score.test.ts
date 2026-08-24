import { describe, expect, it } from 'vitest'
import { classifyReliability, computeReliabilityScore, type CalibrationTable } from '@/lib/reliability-score'
import { summarizeBucket } from '@/lib/reliability-analysis'

const baseline = 0.18

function calibrationFixture(): CalibrationTable {
  return {
    overallBaseline: baseline,
    probability: [
      summarizeBucket('<15%', 55, 382, baseline),
      summarizeBucket('30-34.9%', 16, 66, baseline),
      summarizeBucket('>=40%', 12, 29, baseline),
    ],
    gap: [
      summarizeBucket('<2pts', 60, 400, baseline),
      summarizeBucket('>=15pts', 20, 70, baseline),
    ],
    agreement: [
      summarizeBucket('unanimous', 180, 1000, baseline),
      summarizeBucket('minority', 2, 6, baseline),
    ],
    rawRateRange: { min: 0.1, max: 0.4 },
  }
}

describe('classifyReliability', () => {
  it('maps scores to the spec bands', () => {
    expect(classifyReliability(10)).toBe('Poor')
    expect(classifyReliability(40)).toBe('Below Average')
    expect(classifyReliability(55)).toBe('Average')
    expect(classifyReliability(70)).toBe('Strong')
    expect(classifyReliability(85)).toBe('Very Strong')
    expect(classifyReliability(95)).toBe('Exceptional')
  })
})

describe('computeReliabilityScore', () => {
  const calibration = calibrationFixture()

  it('scores a race that resembles historically strong conditions higher than a weak one', () => {
    const strong = computeReliabilityScore({ probability: 0.42, gap: 0.16, agreeing: 4, totalBaseModels: 4 }, calibration)
    const weak = computeReliabilityScore({ probability: 0.1, gap: 0.01, agreeing: 4, totalBaseModels: 4 }, calibration)
    expect(strong.score).toBeGreaterThan(weak.score)
  })

  it('reports evidence confidence based on the combined sample size backing the factors', () => {
    const result = computeReliabilityScore({ probability: 0.42, gap: 0.16, agreeing: 4, totalBaseModels: 4 }, calibration)
    expect(result.evidenceSampleSize).toBeGreaterThan(0)
    expect(['Low', 'Medium', 'High']).toContain(result.evidenceConfidence)
  })

  it('falls back to the overall baseline when no bucket matches', () => {
    const emptyCalibration: CalibrationTable = { overallBaseline: baseline, probability: [], gap: [], agreement: [], rawRateRange: { min: 0, max: 0 } }
    const result = computeReliabilityScore({ probability: 0.3, gap: 0.05, agreeing: 2, totalBaseModels: 4 }, emptyCalibration)
    expect(result.score).toBe(Math.round(baseline * 100))
    expect(result.evidenceConfidence).toBe('Low')
  })

  it('returns human-readable factor explanations with their historical sample size', () => {
    const result = computeReliabilityScore({ probability: 0.42, gap: 0.16, agreeing: 4, totalBaseModels: 4 }, calibration)
    expect(result.factors.length).toBeGreaterThan(0)
    for (const factor of result.factors) {
      expect(factor.sampleSize).toBeGreaterThan(0)
      expect(typeof factor.label).toBe('string')
    }
  })
})
