import { describe, expect, it } from 'vitest'
import { buildRunnerMarketView, extractTabPrice } from '@/lib/puntersedge/tab-extraction'
import type { PeRunner } from '@/lib/puntersedge/types'

function runner(bookmakers: PeRunner['bookmakers']): Pick<PeRunner, 'bookmakers'> {
  return { bookmakers }
}

describe('extractTabPrice', () => {
  it('extracts win/place price only from the bookmaker keyed "tab"', () => {
    const price = extractTabPrice(
      runner([
        { key: 'sportsbet', win_price: 5.0 },
        { key: 'tab', win_price: 4.2, place_price: 1.8, age_seconds: 10, stale: false, source_url: 'https://tab.com.au/x' },
      ]),
    )
    expect(price).toEqual({
      winPrice: 4.2,
      placePrice: 1.8,
      ageSeconds: 10,
      lastUpdate: null,
      stale: false,
      sourceUrl: 'https://tab.com.au/x',
    })
  })

  it('never substitutes another bookmaker when TAB is absent', () => {
    expect(extractTabPrice(runner([{ key: 'sportsbet', win_price: 5.0 }, { key: 'tabtouch', win_price: 4.5 }]))).toBeNull()
  })

  it('is case-sensitive and does not match a differently-cased key', () => {
    expect(extractTabPrice(runner([{ key: 'TAB', win_price: 4.2 }]))).toBeNull()
  })

  it('returns null when the tab entry has no win_price', () => {
    expect(extractTabPrice(runner([{ key: 'tab', win_price: null }]))).toBeNull()
  })

  it('returns null for a runner with no bookmakers at all', () => {
    expect(extractTabPrice(runner([]))).toBeNull()
  })
})

describe('buildRunnerMarketView', () => {
  it('combines TAB extraction with cross-book consensus and best-price-vs-TAB', () => {
    const view = buildRunnerMarketView(
      runner([
        { key: 'tab', win_price: 4.2 },
        { key: 'sportsbet', win_price: 4.5 },
        { key: 'neds', win_price: 4.0 },
      ]),
    )
    expect(view.tab?.winPrice).toBe(4.2)
    expect(view.tabImpliedProbability).toBeCloseTo(1 / 4.2, 5)
    expect(view.consensus?.bestPrice).toBe(4.5)
    expect(view.bestPriceVsTabDiff).toBeCloseTo(0.3, 5)
  })

  it('handles a runner with no TAB price gracefully (null TAB fields, consensus still computed)', () => {
    const view = buildRunnerMarketView(runner([{ key: 'sportsbet', win_price: 4.5 }]))
    expect(view.tab).toBeNull()
    expect(view.tabImpliedProbability).toBeNull()
    expect(view.bestPriceVsTabDiff).toBeNull()
    expect(view.consensus?.bestPrice).toBe(4.5)
  })

  it('handles a runner with no prices at all', () => {
    const view = buildRunnerMarketView(runner([]))
    expect(view.tab).toBeNull()
    expect(view.consensus).toBeNull()
  })
})
