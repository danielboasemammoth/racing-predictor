/**
 * Central fail-closed risk engine. If ANY input is missing, stale, unhealthy, or a configured
 * limit is breached, the decision is NO_BET - there is no "bet anyway, just log a warning" path.
 * This function is pure (no I/O) so it can be exhaustively unit tested; callers are responsible
 * for gathering fresh inputs (reloaded price, current exposure, health checks) immediately before
 * calling it - see LIVE_BETTING_RUNBOOK.md for the required "reload price -> re-evaluate -> submit"
 * sequence.
 */

export type RacingCode = 'horse' | 'greyhound' | 'harness'
export type MarketStatus = 'OPEN' | 'SUSPENDED' | 'CLOSED' | 'IN_PLAY'

export interface RiskSettings {
  minConfidence: number
  minEdgePct: number
  minExpectedValue: number
  minOdds: number
  maxOdds: number
  minLiquidity: number
  maxLiquidityConsumptionPct: number
  maxBet: number
  maxPctBankroll: number
  maxTotalExposurePct: number
  maxDailyStake: number
  maxDailyLossPct: number
  maxBetsPerDay: number
  maxBetsPerRace: number
  minMinutesToJump: number
  maxMinutesToJump: number
  permittedCodes: RacingCode[]
  permittedStates: string[]
  horseEnabled: boolean
  greyhoundEnabled: boolean
  nswThoroughbredAutoEnabled: boolean
}

export interface SystemHealth {
  betfairConnected: boolean
  liveDataAvailable: boolean
  databaseHealthy: boolean
  riskEngineHealthy: boolean
  duplicateCheckPassed: boolean
}

export interface BetCandidate {
  racingCode: RacingCode
  state: string | null
  marketStatus: MarketStatus
  priceAgeSeconds: number
  decimalOdds: number
  modelProbability: number
  confidence: number
  edgePct: number
  commissionAdjustedExpectedValue: number
  liquidityAvailable: number
  minutesToJump: number
}

export interface AccountState {
  bankrollAvailable: number | null
  dailyStakeSoFar: number
  dailyRealizedLoss: number
  totalOpenExposure: number
  betsPlacedTodayForThisRace: number
  betsPlacedToday: number
  startingDailyBankroll: number
}

export interface RiskDecision {
  decision: 'BET' | 'NO_BET'
  reasons: string[]
}

const MAX_PRICE_AGE_SECONDS = 15

function noBet(reasons: string[]): RiskDecision {
  return { decision: 'NO_BET', reasons }
}

/** Required for every mode. Simulation mode should pass health={betfairConnected:true,...} stubs since it doesn't call the real API. */
function checkHealth(health: SystemHealth): string[] {
  const reasons: string[] = []
  if (!health.betfairConnected) reasons.push('Betfair connection unavailable')
  if (!health.liveDataAvailable) reasons.push('Market data unavailable or not live')
  if (!health.databaseHealthy) reasons.push('Database unavailable')
  if (!health.riskEngineHealthy) reasons.push('Risk engine unhealthy')
  if (!health.duplicateCheckPassed) reasons.push('Duplicate bet detected')
  return reasons
}

export function evaluateBetCandidate(candidate: BetCandidate, settings: RiskSettings, account: AccountState, health: SystemHealth): RiskDecision {
  const healthReasons = checkHealth(health)
  if (healthReasons.length > 0) return noBet(healthReasons)

  if (account.bankrollAvailable == null || account.bankrollAvailable <= 0) {
    return noBet(['Bankroll unavailable or zero'])
  }

  if (candidate.marketStatus !== 'OPEN') {
    return noBet([`Market is ${candidate.marketStatus}, not OPEN - no automated bets after jump`])
  }

  if (candidate.priceAgeSeconds > MAX_PRICE_AGE_SECONDS) {
    return noBet([`Price is ${candidate.priceAgeSeconds}s old (max ${MAX_PRICE_AGE_SECONDS}s) - reload before betting`])
  }

  if (candidate.minutesToJump < settings.minMinutesToJump || candidate.minutesToJump > settings.maxMinutesToJump) {
    return noBet([`Minutes to jump (${candidate.minutesToJump}) outside configured window [${settings.minMinutesToJump}, ${settings.maxMinutesToJump}]`])
  }

  if (candidate.racingCode === 'horse' && !settings.horseEnabled) return noBet(['Horse racing disabled in risk settings'])
  if (candidate.racingCode === 'greyhound' && !settings.greyhoundEnabled) return noBet(['Greyhound racing disabled in risk settings'])
  if (!settings.permittedCodes.includes(candidate.racingCode)) return noBet([`Racing code ${candidate.racingCode} not permitted`])
  if (candidate.state && !settings.permittedStates.includes(candidate.state)) return noBet([`State ${candidate.state} not permitted`])

  if (candidate.racingCode === 'horse' && candidate.state === 'NSW' && !settings.nswThoroughbredAutoEnabled) {
    return noBet(['NSW thoroughbred automated betting is disabled by default (turnover-charge precaution) - enable explicitly if desired'])
  }

  const reasons: string[] = []
  if (candidate.confidence < settings.minConfidence) reasons.push(`Confidence ${(candidate.confidence * 100).toFixed(0)}% below minimum ${(settings.minConfidence * 100).toFixed(0)}%`)
  if (candidate.edgePct < settings.minEdgePct) reasons.push(`Edge ${candidate.edgePct.toFixed(1)}% below minimum ${settings.minEdgePct}%`)
  if (candidate.commissionAdjustedExpectedValue <= settings.minExpectedValue) reasons.push('Commission-adjusted EV does not meet minimum (or is negative)')
  if (candidate.decimalOdds < settings.minOdds || candidate.decimalOdds > settings.maxOdds) reasons.push(`Odds ${candidate.decimalOdds} outside configured range [${settings.minOdds}, ${settings.maxOdds}]`)
  if (candidate.liquidityAvailable < settings.minLiquidity) reasons.push(`Liquidity $${candidate.liquidityAvailable.toFixed(0)} below minimum $${settings.minLiquidity}`)
  if (reasons.length > 0) return noBet(reasons)

  if (account.betsPlacedTodayForThisRace >= settings.maxBetsPerRace) return noBet(['Maximum bets per race already reached'])
  if (account.betsPlacedToday >= settings.maxBetsPerDay) return noBet(['Maximum bets per day already reached'])
  if (account.dailyStakeSoFar >= settings.maxDailyStake) return noBet(['Maximum daily stake already reached'])

  const dailyLossLimit = account.startingDailyBankroll * settings.maxDailyLossPct
  if (account.dailyRealizedLoss >= dailyLossLimit) return noBet(['Daily loss stop triggered - automation paused for the rest of the day'])

  const exposureLimit = account.bankrollAvailable * settings.maxTotalExposurePct
  if (account.totalOpenExposure >= exposureLimit) return noBet(['Maximum total open exposure already reached'])

  return { decision: 'BET', reasons: [] }
}

/** Liquidity guard for stake sizing - never consume more than the configured percentage of visible liquidity at this price. */
export function capStakeToLiquidity(requestedStake: number, liquidityAvailable: number, maxLiquidityConsumptionPct: number): number {
  return Math.min(requestedStake, liquidityAvailable * maxLiquidityConsumptionPct)
}
