/**
 * Which market-data source to TRUST for value/recommendation calculations, when both a Betfair
 * feed and PuntersEdge (TAB-derived) odds are available for the same runner.
 *
 * Betfair's free/development "Delayed" application key delivers prices with a real lag (commonly
 * a minute or more) - fine for browsing markets days out, but unreliable for repricing a runner in
 * the volatile final few minutes before a jump. PuntersEdge's TAB-derived prices are effectively
 * live in this codebase already (see src/lib/puntersedge/client.ts), so they're the better source
 * for VALUE ESTIMATION in that window - UNLESS a genuine BETFAIR_LIVE key is configured, in which
 * case Betfair's own price is both accurate AND the actual venue the bet would execute on.
 *
 * IMPORTANT: this only governs which price informs a recommendation/display. It does NOT change
 * the fail-closed execution rule in risk-engine.ts/LIVE_BETTING_RUNBOOK.md - any real Betfair order
 * always reloads Betfair's own live price immediately before submitting, regardless of which
 * source produced the recommendation. A PuntersEdge/TAB price is never directly executable on
 * Betfair - it's a different market.
 */

export type BetfairDataMode = 'BETFAIR_DISABLED' | 'BETFAIR_DELAYED' | 'BETFAIR_LIVE'
export type MarketDataSource = 'puntersedge' | 'betfair'

/** Below this window, Betfair's delayed-key data is considered too stale to trust for value calculations. */
export const DELAYED_UNRELIABLE_WINDOW_MINUTES = 15

export interface MarketDataSourceDecision {
  source: MarketDataSource
  reason: string
}

export function selectMarketDataSource(betfairMode: BetfairDataMode, minutesToJump: number): MarketDataSourceDecision {
  if (betfairMode === 'BETFAIR_DISABLED') {
    return { source: 'puntersedge', reason: 'No Betfair feed configured' }
  }
  if (betfairMode === 'BETFAIR_LIVE') {
    return { source: 'betfair', reason: 'Live Betfair key - accurate and the actual execution venue' }
  }
  // BETFAIR_DELAYED
  if (minutesToJump <= DELAYED_UNRELIABLE_WINDOW_MINUTES) {
    return { source: 'puntersedge', reason: `Within ${DELAYED_UNRELIABLE_WINDOW_MINUTES} minutes of the jump - Betfair's delayed price is unreliable here` }
  }
  return { source: 'betfair', reason: 'Outside the volatile final-minutes window - delayed price is an acceptable approximation' }
}
