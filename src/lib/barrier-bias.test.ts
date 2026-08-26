import { describe, expect, it } from 'vitest'
import { buildBarrierBiasTable, barrierBiasLift } from '@/lib/barrier-bias'

function row(racecourseId: string, barrier: number, fieldSize: number, won: boolean, distanceM = 1200) {
  return { racecourseId, distanceM, fieldSize, barrier, won }
}

describe('barrier bias table', () => {
  it('finds a global inside-barrier lift when inside draws win far more than baseline', () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => row('track-a', 1, 10, i % 2 === 0)), // inside, 50% win
      ...Array.from({ length: 40 }, (_, i) => row('track-a', 9, 10, i % 10 === 0)), // outside, 10% win
    ]
    const table = buildBarrierBiasTable(rows)
    const insideLift = barrierBiasLift(table, 'track-a', 1200, 10, 1)
    const outsideLift = barrierBiasLift(table, 'track-a', 1200, 10, 9)
    expect(insideLift).toBeGreaterThan(0)
    expect(outsideLift).toBeLessThan(0)
  })

  it('shrinks a small per-track sample toward the global rate for that bucket instead of trusting it outright', () => {
    const globalRows = Array.from({ length: 200 }, (_, i) => row('busy-track', 1, 10, i % 5 === 0)) // 20% baseline
    const smallTrackRows = [row('quiet-track', 1, 10, true), row('quiet-track', 1, 10, true), row('quiet-track', 1, 10, false)] // 2/3 = 66%
    const table = buildBarrierBiasTable([...globalRows, ...smallTrackRows])
    const quietTrackLift = barrierBiasLift(table, 'quiet-track', 1200, 10, 1)
    // With only 3 samples, the shrunk lift must stay far below what a raw 66% strike rate would imply.
    expect(quietTrackLift).toBeLessThan(0.3)
  })

  it('returns 0 lift for a bucket with no data at all', () => {
    const table = buildBarrierBiasTable([row('track-a', 1, 10, true)])
    expect(barrierBiasLift(table, 'unknown-track', 2500, 16, 15)).toBe(0)
  })
})
