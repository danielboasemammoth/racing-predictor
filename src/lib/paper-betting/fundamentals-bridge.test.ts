import { describe, expect, it } from 'vitest'
import { blendWithFundamentals, findMatchingInternalRace, type InternalRaceCandidate } from '@/lib/paper-betting/fundamentals-bridge'

function candidate(overrides: Partial<InternalRaceCandidate> = {}): InternalRaceCandidate {
  return { raceId: 'race-abc', racecourseName: 'Flemington', raceNumber: 4, raceDatetime: '2026-09-01T05:00:00Z', ...overrides }
}

describe('findMatchingInternalRace', () => {
  it('matches on venue (case/whitespace-insensitive), race number, and a close start time', () => {
    const match = findMatchingInternalRace('  FLEMINGTON  ', 4, '2026-09-01T05:05:00Z', [candidate()])
    expect(match?.raceId).toBe('race-abc')
  })

  it('returns null when the venue differs', () => {
    expect(findMatchingInternalRace('Caulfield', 4, '2026-09-01T05:05:00Z', [candidate()])).toBeNull()
  })

  it('returns null when the race number differs', () => {
    expect(findMatchingInternalRace('Flemington', 5, '2026-09-01T05:05:00Z', [candidate()])).toBeNull()
  })

  it('returns null when the start time is outside the tolerance window', () => {
    expect(findMatchingInternalRace('Flemington', 4, '2026-09-01T06:00:00Z', [candidate()])).toBeNull()
  })

  it('returns null (never guesses) when multiple candidates match ambiguously', () => {
    const candidates = [candidate({ raceId: 'a' }), candidate({ raceId: 'b' })]
    expect(findMatchingInternalRace('Flemington', 4, '2026-09-01T05:05:00Z', candidates)).toBeNull()
  })

  it('returns null for an empty candidate list', () => {
    expect(findMatchingInternalRace('Flemington', 4, '2026-09-01T05:05:00Z', [])).toBeNull()
  })
})

describe('blendWithFundamentals', () => {
  it('blends market and fundamentals probabilities and renormalizes to sum to 1', () => {
    const blended = blendWithFundamentals([0.5, 0.5], [0.8, 0.2], 0.5)
    expect(blended.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5)
    expect(blended[0]).toBeGreaterThan(blended[1])
  })

  it('falls back to the market probability for a runner with no fundamentals match', () => {
    const blended = blendWithFundamentals([0.6, 0.4], [null, 0.9], 0.5)
    // runner 0 keeps market weight only, runner 1 blends in fundamentals, then both renormalize
    expect(blended.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5)
  })

  it('returns the market probabilities unchanged when no fundamentals are available at all', () => {
    const blended = blendWithFundamentals([0.7, 0.3], [null, null], 0.5)
    expect(blended[0]).toBeCloseTo(0.7, 5)
    expect(blended[1]).toBeCloseTo(0.3, 5)
  })

  it('weights fully toward fundamentals when blendWeight is 1', () => {
    const blended = blendWithFundamentals([0.5, 0.5], [0.9, 0.1], 1)
    expect(blended[0]).toBeCloseTo(0.9, 5)
    expect(blended[1]).toBeCloseTo(0.1, 5)
  })
})
