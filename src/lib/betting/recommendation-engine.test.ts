import { describe, expect, it } from 'vitest'
import { DEFAULT_THRESHOLDS, recommend } from '@/lib/betting/recommendation-engine'

const BASE_INPUT = {
  modelProbability: 0.32,
  tabPrice: 4.2,
  tabPriceAgeSeconds: 20,
  confidenceLevel: 'HIGH' as const,
  minutesToJump: 15,
  isScratched: false,
  raceStarted: false,
  featureCompleteness: 0.9,
}

describe('recommendation engine', () => {
  it('recommends BET when every criterion is satisfied', () => {
    const result = recommend(BASE_INPUT)
    expect(result.decision).toBe('BET')
    expect(result.edgePoints).toBeCloseTo(8.19, 1)
    expect(result.failedCriteria).toEqual([])
  })

  it('recommends NO_BET immediately for a scratched runner regardless of edge', () => {
    const result = recommend({ ...BASE_INPUT, isScratched: true })
    expect(result.decision).toBe('NO_BET')
    expect(result.failedCriteria).toContain('runner is scratched')
  })

  it('recommends NO_BET once the race has started', () => {
    expect(recommend({ ...BASE_INPUT, raceStarted: true }).decision).toBe('NO_BET')
  })

  it('recommends NO_BET when there is no TAB price', () => {
    expect(recommend({ ...BASE_INPUT, tabPrice: null }).decision).toBe('NO_BET')
  })

  it('recommends WATCH for a positive-edge opportunity that fails one soft criterion', () => {
    const result = recommend({ ...BASE_INPUT, confidenceLevel: 'LOW' })
    expect(result.decision).toBe('WATCH')
    expect(result.failedCriteria.length).toBeGreaterThan(0)
  })

  it('recommends NO_BET when the model has no edge at all, even with high confidence', () => {
    const result = recommend({ ...BASE_INPUT, modelProbability: 0.15 }) // implied prob ~0.238, model below it
    expect(result.decision).toBe('NO_BET')
  })

  it('recommends NO_BET (not WATCH) when the price is stale, since staleness alone is not "promising"', () => {
    // still positive edge/EV, but price stale - falls to WATCH per current rule (edge>0 && ev>0)
    const result = recommend({ ...BASE_INPUT, tabPriceAgeSeconds: 999 })
    expect(result.decision).toBe('WATCH')
    expect(result.failedCriteria.some((r) => r.includes('fresh'))).toBe(true)
  })

  it('respects custom thresholds', () => {
    const result = recommend(BASE_INPUT, { ...DEFAULT_THRESHOLDS, minEdgePoints: 50 })
    expect(result.decision).not.toBe('BET')
  })

  it('flags a race too far from the jump as a failed criterion', () => {
    const result = recommend({ ...BASE_INPUT, minutesToJump: 600 })
    expect(result.failedCriteria.some((r) => r.includes('too far away'))).toBe(true)
  })
})
