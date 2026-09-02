import { describe, expect, it } from 'vitest'
import {
  classifyReliability,
  computeComparableCohort,
  computeReliabilityScore,
  reliabilityCalibrationBands,
  type CalibrationTable,
} from '@/lib/reliability-score'
import { summarizeBucket } from '@/lib/reliability-analysis'
import type { HistoricalRaceFeatures } from '@/lib/similar-races'

const baseline = 0.18

function row(overrides: Partial<HistoricalRaceFeatures> & { correctWinner: boolean }): HistoricalRaceFeatures {
  return {
    raceId: `r${Math.random()}`,
    distanceM: 1200,
    raceType: 'handicap',
    fieldSize: 10,
    trackCondition: 'Good',
    barrierThird: 'middle',
    probability: 0.3,
    gap: 0.1,
    agreeing: 3,
    totalBaseModels: 4,
    ...overrides,
  }
}

/** n races with the given win rate, all sharing the same probability/gap/agreement bands unless overridden. */
function cohort(n: number, winRate: number, overrides: Partial<HistoricalRaceFeatures> = {}): HistoricalRaceFeatures[] {
  return Array.from({ length: n }, (_, i) => row({ correctWinner: i < Math.round(n * winRate), ...overrides }))
}

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

describe('computeComparableCohort (spec Parts 3-4: one genuine cohort, never a sum)', () => {
  it('uses the strictest tier (probability+gap+agreement) when it alone clears the credible sample size', () => {
    const history = [
      ...cohort(40, 0.3, { probability: 0.32, gap: 0.1, agreeing: 3, totalBaseModels: 4 }), // exact tier match
      ...cohort(40, 0.1, { probability: 0.05, gap: 0.01, agreeing: 0, totalBaseModels: 4 }), // different bands entirely
    ]
    const result = computeComparableCohort({ probability: 0.32, gap: 0.1, agreeing: 3, totalBaseModels: 4 }, history)
    expect(result.criteriaUsed).toEqual(['probability', 'gap', 'agreement'])
    expect(result.n).toBe(40)
  })

  it('falls back to a broader tier when the strict tier is too small, and discloses which tier was used', () => {
    const history = [
      ...cohort(5, 0.3, { probability: 0.32, gap: 0.1, agreeing: 3, totalBaseModels: 4 }), // strict tier: only 5, below credible threshold
      ...cohort(40, 0.25, { probability: 0.32, gap: 0.02, agreeing: 3, totalBaseModels: 4 }), // same probability band, different gap band
    ]
    const result = computeComparableCohort({ probability: 0.32, gap: 0.1, agreeing: 3, totalBaseModels: 4 }, history)
    expect(result.criteriaUsed).not.toEqual(['probability', 'gap', 'agreement'])
    expect(result.n).toBeGreaterThanOrEqual(30)
  })

  it('never reports a sample size larger than the number of races actually in the field it matched', () => {
    // This is the direct regression test for the "237 + 186 + 1023 = 1446" bug (spec Part 63,
    // scenario B): the SAME 100 races appearing in multiple marginal buckets must not inflate n.
    const history = cohort(100, 0.2, { probability: 0.32, gap: 0.1, agreeing: 3, totalBaseModels: 4 })
    const result = computeComparableCohort({ probability: 0.32, gap: 0.1, agreeing: 3, totalBaseModels: 4 }, history)
    expect(result.n).toBeLessThanOrEqual(100)
    expect(result.n).toBe(100) // exactly the single overlapping cohort, not 100*3
  })

  it('falls back all the way to the full historical baseline when nothing else has enough evidence', () => {
    const history = cohort(10, 0.4, { probability: 0.9, gap: 0.5, agreeing: 4, totalBaseModels: 4 })
    const result = computeComparableCohort({ probability: 0.05, gap: 0.01, agreeing: 0, totalBaseModels: 4 }, history)
    expect(result.criteriaUsed).toEqual(['all historical races'])
    expect(result.n).toBe(10)
  })
})

describe('computeReliabilityScore - hard vetoes (spec Parts 2, 5, 63)', () => {
  it('scenario A: caps classification at Average when the comparable cohort strike rate is at or below baseline, even if the raw score would otherwise be Strong+', () => {
    // 79 comparable races, 13 wins (~16.5% raw) - the exact spec example - padded with a
    // moderately higher-performing majority so the baseline sits above the cohort's shrunk rate
    // but below its confidence-interval upper bound (isolates veto A from veto B).
    const history = [
      ...cohort(79, 13 / 79, { probability: 0.4, gap: 0.16, agreeing: 4, totalBaseModels: 4 }),
      ...cohort(200, 0.22, { probability: 0.1, gap: 0.01, agreeing: 0, totalBaseModels: 4 }),
    ]
    const calibration = { ...calibrationFixture(), rawRateRange: { min: 0.05, max: 0.2 } }
    const result = computeReliabilityScore({ probability: 0.4, gap: 0.16, agreeing: 4, totalBaseModels: 4 }, calibration, history)
    expect(result.classification).not.toBe('Strong')
    expect(result.classification).not.toBe('Very Strong')
    expect(result.classification).not.toBe('Exceptional')
    expect(result.vetoReason).toMatch(/at or below/i)
  })

  it('scenario C: insufficient evidence caps classification at Average regardless of the raw score', () => {
    // Only 10 total historical races, none matching this input's bands - even the catch-all tier
    // stays below the credible-sample threshold.
    const history = cohort(10, 0.5, { probability: 0.05, gap: 0.01, agreeing: 0, totalBaseModels: 4 })
    const calibration = { ...calibrationFixture(), rawRateRange: { min: 0.05, max: 0.4 } }
    const result = computeReliabilityScore({ probability: 0.42, gap: 0.16, agreeing: 4, totalBaseModels: 4 }, calibration, history)
    expect(result.evidenceConfidence).toBe('Low')
    expect(['Poor', 'Below Average', 'Average']).toContain(result.classification)
  })

  it('scenario D: a cohort whose confidence-interval upper bound is still below baseline is capped at Below Average, not just Average', () => {
    // Cohort: 2 wins / 200 (tight CI, confidently low). Padding gives a materially higher baseline.
    // rawRateRange is narrow around the cohort's own shrunk rate so the RAW score (pre-veto) lands
    // at 'Average' or higher - otherwise capping to 'Below Average' would be a no-op.
    const history = [
      ...cohort(200, 2 / 200, { probability: 0.4, gap: 0.16, agreeing: 4, totalBaseModels: 4 }),
      ...cohort(200, 0.4, { probability: 0.1, gap: 0.01, agreeing: 0, totalBaseModels: 4 }),
    ]
    const calibration = { ...calibrationFixture(), rawRateRange: { min: 0.02, max: 0.03 } }
    const result = computeReliabilityScore({ probability: 0.4, gap: 0.16, agreeing: 4, totalBaseModels: 4 }, calibration, history)
    expect(result.classification).toBe('Below Average')
    expect(result.vetoReason).toMatch(/confidence interval/i)
  })

  it('allows Strong+ when the comparable cohort genuinely and significantly beats baseline with enough evidence', () => {
    const history = [
      ...cohort(100, 0.5, { probability: 0.4, gap: 0.16, agreeing: 4, totalBaseModels: 4 }), // well above baseline, large n
      ...cohort(300, 0.15, { probability: 0.1, gap: 0.01, agreeing: 0, totalBaseModels: 4 }),
    ]
    const calibration = { ...calibrationFixture(), overallBaseline: 0.18, rawRateRange: { min: 0.1, max: 0.5 } }
    const result = computeReliabilityScore({ probability: 0.4, gap: 0.16, agreeing: 4, totalBaseModels: 4 }, calibration, history)
    expect(result.vetoReason).toBeNull()
    expect(['Strong', 'Very Strong', 'Exceptional']).toContain(result.classification)
  })
})

describe('computeReliabilityScore - general behaviour', () => {
  it('falls back to the overall baseline when history is empty', () => {
    const emptyCalibration: CalibrationTable = { overallBaseline: baseline, probability: [], gap: [], agreement: [], rawRateRange: { min: 0, max: 0 } }
    const result = computeReliabilityScore({ probability: 0.3, gap: 0.05, agreeing: 2, totalBaseModels: 4 }, emptyCalibration, [])
    expect(result.score).toBe(Math.round(baseline * 100))
    expect(result.evidenceConfidence).toBe('Low')
  })

  it('marks a marginal factor as not significant when its lift is negligible (spec Parts 24-25)', () => {
    // agreement bucket: 18.4% vs 18.4% baseline - zero lift, must never be flagged "significant".
    const calibration: CalibrationTable = {
      overallBaseline: 0.184,
      probability: [summarizeBucket('30-34.9%', 30, 100, 0.184)],
      gap: [summarizeBucket('10-14.9pts', 30, 100, 0.184)],
      agreement: [summarizeBucket('unanimous', 184, 1000, 0.184)],
      rawRateRange: { min: 0.1, max: 0.4 },
    }
    const result = computeReliabilityScore({ probability: 0.32, gap: 0.12, agreeing: 4, totalBaseModels: 4 }, calibration, [])
    const agreementFactor = result.factors.find((f) => f.label.startsWith('Multi-model agreement'))
    expect(agreementFactor?.significant).toBe(false)
  })

  it('returns human-readable factor explanations with their historical sample size', () => {
    const calibration = calibrationFixture()
    const result = computeReliabilityScore({ probability: 0.42, gap: 0.16, agreeing: 4, totalBaseModels: 4 }, calibration, [])
    expect(result.factors.length).toBeGreaterThan(0)
    for (const factor of result.factors) {
      expect(factor.sampleSize).toBeGreaterThan(0)
      expect(typeof factor.label).toBe('string')
      expect(typeof factor.significant).toBe('boolean')
    }
  })
})

describe('reliabilityCalibrationBands', () => {
  it('reports the actual strike rate observed within each Reliability Score band', () => {
    const calibration = calibrationFixture()
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({ correctWinner: i % 2 === 0, probability: 0.42, gap: 0.16, agreeing: 4, totalBaseModels: 4 })),
      ...Array.from({ length: 20 }, (_, i) => ({ correctWinner: i % 10 === 0, probability: 0.1, gap: 0.01, agreeing: 4, totalBaseModels: 4 })),
    ]
    const bands = reliabilityCalibrationBands(rows, calibration, [])
    expect(bands.length).toBeGreaterThan(0)
    for (const band of bands) {
      expect(band.strikeRate).toBeCloseTo(band.wins / band.n)
    }
  })

  it('omits bands with no races rather than reporting a false zero', () => {
    const calibration = calibrationFixture()
    const bands = reliabilityCalibrationBands([{ correctWinner: true, probability: 0.42, gap: 0.16, agreeing: 4, totalBaseModels: 4 }], calibration, [])
    expect(bands.every((band) => band.n > 0)).toBe(true)
  })
})
