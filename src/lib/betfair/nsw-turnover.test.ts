import { describe, it, expect } from 'vitest'
import { classifyNswTurnoverStatus, estimatedNswTurnoverCharge, shouldBlockAutomatedNswBetting, NSW_TURNOVER_THRESHOLD } from './nsw-turnover'

describe('classifyNswTurnoverStatus', () => {
  it('is ok well below the threshold', () => {
    const status = classifyNswTurnoverStatus(200, 20)
    expect(status.state).toBe('ok')
    expect(status.turnoverThresholdPct).toBeCloseTo(0.2, 6)
  })

  it('warns at 75% of the turnover threshold', () => {
    expect(classifyNswTurnoverStatus(750, 75).state).toBe('warning')
  })

  it('strongly warns at 90%', () => {
    expect(classifyNswTurnoverStatus(900, 90).state).toBe('strong_warning')
  })

  it('blocks at 100% turnover regardless of commission ratio (precautionary default)', () => {
    // commission ratio here is 10% (>> 1.25%), so the FORMAL charge condition is not met,
    // but we still block automated betting as a precaution once turnover itself hits the threshold.
    const status = classifyNswTurnoverStatus(NSW_TURNOVER_THRESHOLD, 100)
    expect(status.state).toBe('blocked')
    expect(status.potentiallyApplicable).toBe(false)
  })

  it('flags potentiallyApplicable only when both the turnover AND low-commission-ratio conditions are met', () => {
    const status = classifyNswTurnoverStatus(2000, 10) // ratio = 0.5% < 1.25%
    expect(status.potentiallyApplicable).toBe(true)
    expect(status.state).toBe('blocked')
  })

  it('handles zero turnover without dividing by zero', () => {
    const status = classifyNswTurnoverStatus(0, 0)
    expect(status.commissionToTurnoverRatio).toBeNull()
    expect(status.state).toBe('ok')
  })
})

describe('estimatedNswTurnoverCharge', () => {
  it('is 3% of turnover', () => {
    expect(estimatedNswTurnoverCharge(1000)).toBeCloseTo(30, 6)
  })
})

describe('shouldBlockAutomatedNswBetting', () => {
  it('blocks when state is blocked or strong_warning and no override', () => {
    expect(shouldBlockAutomatedNswBetting(classifyNswTurnoverStatus(1000, 100), false)).toBe(true)
    expect(shouldBlockAutomatedNswBetting(classifyNswTurnoverStatus(900, 90), false)).toBe(true)
  })

  it('does not block at warning/ok levels', () => {
    expect(shouldBlockAutomatedNswBetting(classifyNswTurnoverStatus(750, 75), false)).toBe(false)
    expect(shouldBlockAutomatedNswBetting(classifyNswTurnoverStatus(100, 10), false)).toBe(false)
  })

  it('respects an explicit user override', () => {
    expect(shouldBlockAutomatedNswBetting(classifyNswTurnoverStatus(1000, 100), true)).toBe(false)
  })
})
