import { describe, expect, it } from 'vitest'
import { runningPositionPercentile, classifyRunningStyle, habitualRunningStyle, summarizePaceShape } from '@/lib/race-shape'

describe('race shape / pace model', () => {
  it('normalizes a raw settled position to a 0-1 percentile of field size', () => {
    expect(runningPositionPercentile(1, 8)).toBe(0)
    expect(runningPositionPercentile(8, 8)).toBe(1)
    expect(runningPositionPercentile(1, 1)).toBe(0)
  })

  it('classifies running style from position percentile', () => {
    expect(classifyRunningStyle(0)).toBe('leader')
    expect(classifyRunningStyle(0.3)).toBe('on-pace')
    expect(classifyRunningStyle(0.6)).toBe('midfield')
    expect(classifyRunningStyle(0.9)).toBe('backmarker')
  })

  it('picks the most common style across a horse\'s settled-position history', () => {
    expect(habitualRunningStyle([
      { positionAtSettled: 1, fieldSize: 8 },
      { positionAtSettled: 2, fieldSize: 8 },
      { positionAtSettled: 6, fieldSize: 8 },
    ])).toBe('leader')
  })

  it('returns unknown for a first starter with no settled-position history', () => {
    expect(habitualRunningStyle([])).toBe('unknown')
    expect(habitualRunningStyle([{ positionAtSettled: null, fieldSize: 8 }])).toBe('unknown')
  })

  it('flags an uncontested pace when at most one horse is a leader/on-pace type', () => {
    expect(summarizePaceShape(['leader', 'midfield', 'midfield', 'backmarker']).pacePressure).toBe('uncontested')
  })

  it('flags a hot pace with several leaders/on-pace types', () => {
    expect(summarizePaceShape(['leader', 'leader', 'leader', 'on-pace', 'midfield']).pacePressure).toBe('hot')
  })

  it('flags a moderate pace in between', () => {
    expect(summarizePaceShape(['leader', 'on-pace', 'midfield', 'backmarker']).pacePressure).toBe('moderate')
  })
})
