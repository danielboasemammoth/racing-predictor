/**
 * Betfair charges commission on NET MARKET WINNINGS, not on each individual winning selection in
 * isolation. A backer who has multiple bets in the same market nets them off first; commission
 * only applies if the resulting market position is a profit, at the applicable Market Base Rate
 * (MBR). MBR varies by jurisdiction/state/code and must never be hardcoded - see
 * betfair_market_base_rates and BETTING_RISK_ENGINE.md.
 */

/** Commission on a market, given its net profit (already netted across all selections in that market). */
export function computeMarketCommission(netMarketProfit: number, marketBaseRate: number): number {
  if (netMarketProfit <= 0) return 0
  return netMarketProfit * marketBaseRate
}

export function computeNetProfitAfterCommission(netMarketProfit: number, marketBaseRate: number): number {
  return netMarketProfit - computeMarketCommission(netMarketProfit, marketBaseRate)
}

/**
 * Single back-bet approximation used for pre-bet display (raw edge vs commission-adjusted edge).
 * Real settlement must use market-level net profit via computeMarketCommission, not this shortcut,
 * once multiple bets exist in the same market.
 */
export function approxNetProfitIfWins(stake: number, decimalOdds: number, marketBaseRate: number): number {
  const grossProfit = stake * (decimalOdds - 1)
  return computeNetProfitAfterCommission(grossProfit, marketBaseRate)
}

/** Commission-adjusted expected value for a single back bet, used to gate automated bet qualification. */
export function commissionAdjustedExpectedValue(
  stake: number,
  decimalOdds: number,
  modelProbability: number,
  marketBaseRate: number,
): number {
  const netProfitIfWins = approxNetProfitIfWins(stake, decimalOdds, marketBaseRate)
  return modelProbability * netProfitIfWins - (1 - modelProbability) * stake
}
