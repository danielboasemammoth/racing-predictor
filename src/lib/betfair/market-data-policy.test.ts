import { describe, it, expect } from 'vitest'
import { selectMarketDataSource, DELAYED_UNRELIABLE_WINDOW_MINUTES } from './market-data-policy'

describe('selectMarketDataSource', () => {
  it('always uses PuntersEdge when Betfair is disabled', () => {
    expect(selectMarketDataSource('BETFAIR_DISABLED', 60).source).toBe('puntersedge')
    expect(selectMarketDataSource('BETFAIR_DISABLED', 1).source).toBe('puntersedge')
  })

  it('always uses Betfair when a live key is configured, regardless of timing', () => {
    expect(selectMarketDataSource('BETFAIR_LIVE', 60).source).toBe('betfair')
    expect(selectMarketDataSource('BETFAIR_LIVE', 1).source).toBe('betfair')
  })

  it('prefers PuntersEdge over a delayed Betfair feed within the unreliable final-minutes window', () => {
    expect(selectMarketDataSource('BETFAIR_DELAYED', DELAYED_UNRELIABLE_WINDOW_MINUTES).source).toBe('puntersedge')
    expect(selectMarketDataSource('BETFAIR_DELAYED', 1).source).toBe('puntersedge')
  })

  it('prefers a delayed Betfair feed outside the unreliable window', () => {
    expect(selectMarketDataSource('BETFAIR_DELAYED', DELAYED_UNRELIABLE_WINDOW_MINUTES + 1).source).toBe('betfair')
    expect(selectMarketDataSource('BETFAIR_DELAYED', 120).source).toBe('betfair')
  })

  it('always includes a human-readable reason', () => {
    for (const mode of ['BETFAIR_DISABLED', 'BETFAIR_DELAYED', 'BETFAIR_LIVE'] as const) {
      expect(selectMarketDataSource(mode, 10).reason.length).toBeGreaterThan(0)
    }
  })
})
