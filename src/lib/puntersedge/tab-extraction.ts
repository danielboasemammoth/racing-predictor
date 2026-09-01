import { TAB_BOOKMAKER_KEY, type PeBookmakerPrice, type PeRunner } from '@/lib/puntersedge/types'
import { impliedProbability, runnerMarketConsensus, type BookmakerPricePoint } from '@/lib/betting/odds-math'

export interface TabPrice {
  winPrice: number
  placePrice: number | null
  ageSeconds: number | null
  lastUpdate: string | null
  stale: boolean
  sourceUrl: string | null
}

/**
 * Extracts the TAB price from a runner's bookmaker panel. Matches on bookmaker.key === "tab"
 * exactly (case-sensitive, per PuntersEdge's own key spelling) - never substitute another book's
 * price when this returns null, since TAB is the paper-betting benchmark.
 */
export function extractTabPrice(runner: Pick<PeRunner, 'bookmakers'>): TabPrice | null {
  const tab = (runner.bookmakers ?? []).find((b) => b.key === TAB_BOOKMAKER_KEY)
  if (!tab || tab.win_price == null) return null
  return {
    winPrice: tab.win_price,
    placePrice: tab.place_price ?? null,
    ageSeconds: tab.age_seconds ?? null,
    lastUpdate: tab.last_update ?? null,
    stale: tab.stale ?? false,
    sourceUrl: tab.source_url ?? null,
  }
}

function toPricePoints(bookmakers: PeBookmakerPrice[]): BookmakerPricePoint[] {
  return bookmakers
    .filter((b): b is PeBookmakerPrice & { win_price: number } => b.win_price != null)
    .map((b) => ({ bookmakerKey: b.key, price: b.win_price }))
}

export interface RunnerMarketView {
  tab: TabPrice | null
  consensus: ReturnType<typeof runnerMarketConsensus>
  /** TAB's own implied win probability, or null if no TAB price is available. */
  tabImpliedProbability: number | null
  /** Positive = the best available price beats TAB; the punter is leaving value on the table by only using TAB. */
  bestPriceVsTabDiff: number | null
}

/** Combines TAB extraction with cross-bookmaker consensus for a single runner. */
export function buildRunnerMarketView(runner: Pick<PeRunner, 'bookmakers'>): RunnerMarketView {
  const tab = extractTabPrice(runner)
  const consensus = runnerMarketConsensus(toPricePoints(runner.bookmakers ?? []))
  return {
    tab,
    consensus,
    tabImpliedProbability: tab ? impliedProbability(tab.winPrice) : null,
    bestPriceVsTabDiff: tab && consensus ? consensus.bestPrice - tab.winPrice : null,
  }
}
