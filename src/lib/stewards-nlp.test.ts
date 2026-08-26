import { describe, expect, it } from 'vitest'
import { extractStewardsFlags, hadTroubledRun } from '@/lib/stewards-nlp'

describe('stewards comment NLP', () => {
  it('flags a slow beginning', () => {
    expect(extractStewardsFlags('Slow to begin.').slowStart).toBe(true)
    expect(extractStewardsFlags('Began awkwardly and lost ground.').slowStart).toBe(true)
  })

  it('flags being held up for a run', () => {
    expect(extractStewardsFlags('Held up for clear running rounding the home turn.').heldUp).toBe(true)
    expect(extractStewardsFlags('Disappointed for a run leaving the 250 metres.').heldUp).toBe(true)
  })

  it('flags checked/interference incidents', () => {
    expect(extractStewardsFlags('Checked when tightened near the 3100m.').checkedOrInterference).toBe(true)
    expect(extractStewardsFlags('Hampered after the first obstacle.').checkedOrInterference).toBe(true)
  })

  it('flags a wide run', () => {
    expect(extractStewardsFlags('Raced wide throughout.').racedWide).toBe(true)
  })

  it('flags over-racing/keenness', () => {
    expect(extractStewardsFlags('Raced keenly in the middle stages.').overraced).toBe(true)
  })

  it('returns all-false flags for a clean run or no comment', () => {
    const flags = extractStewardsFlags(null)
    expect(Object.values(flags).every((value) => value === false)).toBe(true)
  })

  it('hadTroubledRun is true when any unlucky-run flag is set', () => {
    expect(hadTroubledRun(extractStewardsFlags('Checked near the 400m.'))).toBe(true)
    expect(hadTroubledRun(extractStewardsFlags('Raced keenly in the early stages.'))).toBe(false)
  })
})
