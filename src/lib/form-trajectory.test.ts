import { describe, expect, it } from 'vitest'
import { formTrend } from '@/lib/form-trajectory'

describe('form trajectory', () => {
  it('is positive for a horse whose recent-first results are improving over time', () => {
    // recent-first: most recent run scored best, oldest scored worst
    const trend = formTrend([{ resultScore: 0.9 }, { resultScore: 0.6 }, { resultScore: 0.3 }])
    expect(trend).not.toBeNull()
    expect(trend!).toBeGreaterThan(0)
  })

  it('is negative for a horse whose recent-first results are declining over time', () => {
    const trend = formTrend([{ resultScore: 0.2 }, { resultScore: 0.5 }, { resultScore: 0.8 }])
    expect(trend).not.toBeNull()
    expect(trend!).toBeLessThan(0)
  })

  it('is zero for perfectly flat form', () => {
    expect(formTrend([{ resultScore: 0.5 }, { resultScore: 0.5 }, { resultScore: 0.5 }])).toBe(0)
  })

  it('returns null with fewer than 3 starts', () => {
    expect(formTrend([])).toBeNull()
    expect(formTrend([{ resultScore: 0.5 }])).toBeNull()
    expect(formTrend([{ resultScore: 0.5 }, { resultScore: 0.8 }])).toBeNull()
  })
})
