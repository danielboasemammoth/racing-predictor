import { describe, expect, it } from 'vitest'
import {
  computeBoxFitScore,
  computeGreyhoundFundamentalsProbabilities,
  computeRecentFormScore,
  type GreyhoundDogInput,
} from '@/lib/paper-betting/greyhound-fundamentals'
import type { PeGreyhoundFormRun, PeGreyhoundStatsGroup } from '@/lib/puntersedge/types'

function run(overrides: Partial<PeGreyhoundFormRun> = {}): PeGreyhoundFormRun {
  return {
    date: '2026-09-01',
    track: 'Hobart',
    distance_m: 400,
    grade: '5',
    race_number: 1,
    box: 1,
    rug: 1,
    weight_kg: 27,
    sp: 4.5,
    position: 1,
    scratched: false,
    time_s: 22.5,
    win_time_s: 22.5,
    margin: null,
    margin_s: null,
    grade_in: '5',
    grade_out: '5',
    trainer: null,
    ...overrides,
  }
}

function boxGroup(overrides: Partial<PeGreyhoundStatsGroup> = {}): PeGreyhoundStatsGroup {
  return { track: null, distance_m: null, box: 1, grade: null, starts: 10, wins: 3, places: 5, win_pct: 30, place_pct: 50, avg_time_s: 22.5, best_time_s: 22.1, ...overrides }
}

describe('computeRecentFormScore', () => {
  it('returns null when there are no usable runs', () => {
    expect(computeRecentFormScore([])).toBeNull()
    expect(computeRecentFormScore([run({ scratched: true })])).toBeNull()
    expect(computeRecentFormScore([run({ position: null })])).toBeNull()
  })

  it('scores a recent win higher than a recent last place', () => {
    const winner = computeRecentFormScore([run({ position: 1 })])
    const lastPlace = computeRecentFormScore([run({ position: 8 })])
    expect(winner).not.toBeNull()
    expect(winner!).toBeGreaterThan(lastPlace!)
  })

  it('applies a margin penalty when margin_s is present', () => {
    const closeSecond = computeRecentFormScore([run({ position: 2, margin_s: 0.1 })])
    const distantSecond = computeRecentFormScore([run({ position: 2, margin_s: 2.5 })])
    expect(closeSecond!).toBeGreaterThan(distantSecond!)
  })

  it('weights more recent runs higher than older ones', () => {
    const recentWinThenOldLoss = computeRecentFormScore([run({ position: 1 }), run({ position: 8 })])
    const recentLossThenOldWin = computeRecentFormScore([run({ position: 8 }), run({ position: 1 })])
    expect(recentWinThenOldLoss!).toBeGreaterThan(recentLossThenOldWin!)
  })

  it('excludes scratched runs from the calculation', () => {
    const withScratch = computeRecentFormScore([run({ position: 1 }), run({ scratched: true, position: null })])
    const withoutScratch = computeRecentFormScore([run({ position: 1 })])
    expect(withScratch).toBeCloseTo(withoutScratch!, 10)
  })
})

describe('computeBoxFitScore', () => {
  it('returns win_pct/100 for a matching box with enough starts', () => {
    expect(computeBoxFitScore([boxGroup({ box: 3, win_pct: 40, starts: 5 })], 3)).toBeCloseTo(0.4, 5)
  })

  it('returns null when no group matches the box', () => {
    expect(computeBoxFitScore([boxGroup({ box: 3 })], 5)).toBeNull()
  })

  it('returns null when the matching group has too few starts to be credible', () => {
    expect(computeBoxFitScore([boxGroup({ box: 3, starts: 1 })], 3)).toBeNull()
  })
})

describe('computeGreyhoundFundamentalsProbabilities', () => {
  function dog(overrides: Partial<GreyhoundDogInput> = {}): GreyhoundDogInput {
    return { runnerNumber: 1, form: [run({ position: 1 })], boxStatsGroups: null, currentBox: null, ...overrides }
  }

  it('produces probabilities that sum to 1 across dogs with any signal', () => {
    const result = computeGreyhoundFundamentalsProbabilities([
      dog({ runnerNumber: 1, form: [run({ position: 1 })] }),
      dog({ runnerNumber: 2, form: [run({ position: 5 })] }),
    ])
    const total = [...result.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('gives a dog with consistently better recent form a higher probability', () => {
    const result = computeGreyhoundFundamentalsProbabilities([
      dog({ runnerNumber: 1, form: [run({ position: 1 }), run({ position: 1 })] }),
      dog({ runnerNumber: 2, form: [run({ position: 7 }), run({ position: 8 })] }),
    ])
    expect(result.get(1)!).toBeGreaterThan(result.get(2)!)
  })

  it('omits a dog with no form and no box stats from the result, but still counts it in the field for scale', () => {
    const result = computeGreyhoundFundamentalsProbabilities([
      dog({ runnerNumber: 1, form: [run({ position: 1 })] }),
      dog({ runnerNumber: 2, form: null, boxStatsGroups: null }),
    ])
    expect(result.has(2)).toBe(false)
    // Must NOT be ~1.0 (the bug this replaced) - a single populated dog in a 2-runner field is
    // favoured but the other (data-less) dog still absorbs real probability mass in the softmax.
    expect(result.get(1)!).toBeGreaterThan(0.5)
    expect(result.get(1)!).toBeLessThan(0.9)
  })

  it('returns an empty map when no dog has any signal', () => {
    const result = computeGreyhoundFundamentalsProbabilities([dog({ runnerNumber: 1, form: null }), dog({ runnerNumber: 2, form: null })])
    expect(result.size).toBe(0)
  })

  it('incorporates box fit alongside form for a dog with both', () => {
    const withGoodBox = computeGreyhoundFundamentalsProbabilities([
      dog({ runnerNumber: 1, form: [run({ position: 4 })], boxStatsGroups: [boxGroup({ box: 1, win_pct: 60, starts: 20 })], currentBox: 1 }),
      dog({ runnerNumber: 2, form: [run({ position: 4 })], boxStatsGroups: [boxGroup({ box: 1, win_pct: 5, starts: 20 })], currentBox: 1 }),
    ])
    expect(withGoodBox.get(1)!).toBeGreaterThan(withGoodBox.get(2)!)
  })

  it('regression: sparse coverage in a large field must not inflate a single populated dog to near-100%', () => {
    // Reproduces the real bug found via a live smoke test 2026-09-07: only 1 of 8 runners had
    // fresh data (fetch-budget-limited), and the old implementation returned ~1.0 for that dog.
    const field: GreyhoundDogInput[] = [dog({ runnerNumber: 1, form: [run({ position: 1 })] })]
    for (let n = 2; n <= 8; n += 1) field.push(dog({ runnerNumber: n, form: null, boxStatsGroups: null }))
    const result = computeGreyhoundFundamentalsProbabilities(field)
    expect(result.size).toBe(1)
    expect(result.get(1)!).toBeLessThan(0.5)
  })
})
