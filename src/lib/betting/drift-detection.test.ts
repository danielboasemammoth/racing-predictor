import { describe, expect, it } from 'vitest'
import { detectDrift, type DriftBetSample } from '@/lib/betting/drift-detection'

function makeBets(n: number, overrides: Partial<DriftBetSample> = {}): DriftBetSample[] {
  return Array.from({ length: n }, (_, i) => ({
    modelProbability: 0.3,
    won: i % 3 !== 0, // ~66% win rate
    profit: i % 3 !== 0 ? 20 : -10,
    stake: 10,
    edgePoints: 5,
    ...overrides,
  }))
}

describe('detectDrift', () => {
  it('reports insufficient data and raises no flags below the credible sample size', () => {
    const report = detectDrift(makeBets(10), makeBets(10))
    expect(report.sufficientData).toBe(false)
    expect(report.flags).toEqual([])
  })

  it('raises no flags when recent performance matches the baseline', () => {
    const report = detectDrift(makeBets(50), makeBets(50))
    expect(report.sufficientData).toBe(true)
    expect(report.flags).toEqual([])
  })

  it('flags calibration deterioration when Brier score worsens materially', () => {
    const baseline = makeBets(50, { modelProbability: 0.7, won: true, profit: 4.3 }) // well-calibrated
    const recent = makeBets(50, { modelProbability: 0.7, won: false, profit: -10 }) // confidently wrong now
    const report = detectDrift(recent, baseline)
    expect(report.flags.some((f) => f.metric === 'calibration')).toBe(true)
  })

  it('flags ROI deterioration when ROI drops materially even with stable calibration', () => {
    const baseline = makeBets(50, { profit: 20 }) // +200% ROI
    const recent = makeBets(50, { profit: -5 }) // -50% ROI
    const report = detectDrift(recent, baseline)
    expect(report.flags.some((f) => f.metric === 'roi')).toBe(true)
  })

  it('flags edge-conversion failure when edge holds steady but ROI collapses', () => {
    const baseline = makeBets(50, { edgePoints: 6, profit: 20 })
    const recent = makeBets(50, { edgePoints: 6, profit: -8 })
    const report = detectDrift(recent, baseline)
    expect(report.flags.some((f) => f.metric === 'edge_conversion')).toBe(true)
  })

  it('flags a shift in the prediction distribution', () => {
    const baseline = makeBets(50, { modelProbability: 0.25 })
    const recent = makeBets(50, { modelProbability: 0.6 })
    const report = detectDrift(recent, baseline)
    expect(report.flags.some((f) => f.metric === 'prediction_distribution')).toBe(true)
  })

  it('summarizes n=0 windows without throwing', () => {
    const report = detectDrift([], [])
    expect(report.recentWindow.n).toBe(0)
    expect(report.recentWindow.brierScore).toBeNull()
    expect(report.sufficientData).toBe(false)
  })
})
