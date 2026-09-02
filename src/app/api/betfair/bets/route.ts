import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBankrollConfig, getRiskSettings, getTodayAccountState, placeSimulatedBet, listRecentBets, writeAuditLog } from '@/lib/betfair/repository'
import { evaluateBetCandidate, capStakeToLiquidity, type RiskSettings, type BetCandidate, type AccountState, type SystemHealth } from '@/lib/betfair/risk-engine'
import { computeStake, type BetfairStakingMethod } from '@/lib/betfair/staking'
import { commissionAdjustedExpectedValue } from '@/lib/betfair/commission'
import { SimulationExecutionProvider, type MarketSnapshot } from '@/lib/betfair/providers'

export async function GET() {
  const admin = createAdminClient()
  const bets = await listRecentBets(admin)
  return NextResponse.json({ success: true, bets })
}

interface SimulateBetBody {
  marketId?: string
  selectionId?: string
  runnerName?: string
  racingCode?: 'horse' | 'greyhound' | 'harness'
  venue?: string | null
  raceNumber?: number | null
  state?: string | null
  jumpTime?: string | null
  currentBestPrice?: number
  availableLiquidity?: number
  minutesToJump?: number
  modelProbability?: number
  confidence?: number
  modelVersion?: string
  featureVersion?: string | null
  marketBaseRate?: number
  minAcceptableOdds?: number
  stakeOverride?: number
}

/**
 * STAGE 1 SIMULATION ONLY: places a bet against a manually-supplied "current market" snapshot
 * (currentBestPrice/availableLiquidity), since no real BetfairMarketDataProvider is wired up yet.
 * Runs the exact same risk engine + staking + commission-aware EV pipeline that a real
 * BetfairExecutionProvider would use in Stage 2+ - only the market-data source differs.
 * Settlement (WON/LOST) is NOT implemented yet - bets remain in MATCHED/PARTIALLY_MATCHED status.
 */
export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as SimulateBetBody | null
  if (
    !body?.marketId || !body.selectionId || !body.runnerName || !body.racingCode ||
    !body.currentBestPrice || !body.availableLiquidity || body.minutesToJump == null ||
    body.modelProbability == null || body.confidence == null || !body.modelVersion || !body.marketBaseRate
  ) {
    return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 })
  }
  if (body.currentBestPrice <= 1) return NextResponse.json({ success: false, message: 'Invalid price' }, { status: 400 })

  const admin = createAdminClient()
  const [bankrollConfig, riskSettingsRow, todayState] = await Promise.all([getBankrollConfig(admin), getRiskSettings(admin), getTodayAccountState(admin)])

  const marketProbability = 1 / body.currentBestPrice
  const rawEdgePct = ((body.modelProbability - marketProbability) / marketProbability) * 100
  const fairOdds = 1 / body.modelProbability
  const commissionAdjustedEv = commissionAdjustedExpectedValue(1, body.currentBestPrice, body.modelProbability, body.marketBaseRate)

  const riskSettings: RiskSettings = {
    minConfidence: riskSettingsRow.min_confidence,
    minEdgePct: riskSettingsRow.min_edge_pct,
    minExpectedValue: riskSettingsRow.min_expected_value,
    minOdds: riskSettingsRow.min_odds,
    maxOdds: riskSettingsRow.max_odds,
    minLiquidity: riskSettingsRow.min_liquidity,
    maxLiquidityConsumptionPct: riskSettingsRow.max_liquidity_consumption_pct,
    maxBet: riskSettingsRow.max_bet,
    maxPctBankroll: riskSettingsRow.max_pct_bankroll,
    maxTotalExposurePct: riskSettingsRow.max_total_exposure_pct,
    maxDailyStake: riskSettingsRow.max_daily_stake,
    maxDailyLossPct: riskSettingsRow.max_daily_loss_pct,
    maxBetsPerDay: riskSettingsRow.max_bets_per_day,
    maxBetsPerRace: riskSettingsRow.max_bets_per_race,
    minMinutesToJump: riskSettingsRow.min_minutes_to_jump,
    maxMinutesToJump: riskSettingsRow.max_minutes_to_jump,
    permittedCodes: riskSettingsRow.permitted_codes as RiskSettings['permittedCodes'],
    permittedStates: riskSettingsRow.permitted_states,
    horseEnabled: riskSettingsRow.horse_enabled,
    greyhoundEnabled: riskSettingsRow.greyhound_enabled,
    nswThoroughbredAutoEnabled: riskSettingsRow.nsw_thoroughbred_auto_enabled,
  }

  const candidate: BetCandidate = {
    racingCode: body.racingCode,
    state: body.state ?? null,
    marketStatus: 'OPEN',
    priceAgeSeconds: 0,
    decimalOdds: body.currentBestPrice,
    modelProbability: body.modelProbability,
    confidence: body.confidence,
    edgePct: rawEdgePct,
    commissionAdjustedExpectedValue: commissionAdjustedEv,
    liquidityAvailable: body.availableLiquidity,
    minutesToJump: body.minutesToJump,
  }

  const bankrollAvailable = Math.min(bankrollConfig.simulated_current_bankroll, bankrollConfig.allocated_bankroll)
  const account: AccountState = {
    bankrollAvailable,
    dailyStakeSoFar: todayState.dailyStakeSoFar,
    dailyRealizedLoss: todayState.dailyRealizedLoss,
    totalOpenExposure: 0, // Stage 1: settlement isn't implemented yet, so open exposure tracking is deferred - see BETTING_RISK_ENGINE.md limitations.
    betsPlacedTodayForThisRace: 0, // Stage 1 simplification - per-race daily counts need a market_id+date query, deferred alongside settlement.
    betsPlacedToday: todayState.betsPlacedToday,
    startingDailyBankroll: bankrollConfig.simulated_current_bankroll,
  }

  const health: SystemHealth = {
    betfairConnected: true, // Simulation mode has no real Betfair dependency by design.
    liveDataAvailable: true, // Manually-supplied "market" snapshot, always treated as available in Stage 1.
    databaseHealthy: true,
    riskEngineHealthy: true,
    duplicateCheckPassed: true, // Enforced by the idempotency_key unique constraint at insert time below.
  }

  const decision = evaluateBetCandidate(candidate, riskSettings, account, health)
  if (decision.decision === 'NO_BET') {
    await writeAuditLog(admin, 'bet_rejected', null, { marketId: body.marketId, selectionId: body.selectionId }, decision.reasons.join('; '), 'admin')
    return NextResponse.json({ success: true, decision: 'NO_BET', reasons: decision.reasons })
  }

  const method = riskSettingsRow.staking_method as BetfairStakingMethod
  const limits = { maxBet: riskSettingsRow.max_bet, maxPctBankroll: riskSettingsRow.max_pct_bankroll }
  let stake: number
  if (body.stakeOverride != null) {
    // Manual bets use the user's entered stake (not forced through Kelly), still capped for safety.
    stake = Math.min(body.stakeOverride, bankrollAvailable * limits.maxPctBankroll, limits.maxBet)
  } else {
    stake = computeStake({
      method,
      bankroll: bankrollAvailable,
      decimalOdds: body.currentBestPrice,
      modelProbability: body.modelProbability,
      flatStakeAmount: riskSettingsRow.flat_stake_amount,
      pctBankrollStake: riskSettingsRow.pct_bankroll_stake,
      limits,
      confidence: body.confidence,
      modelUncertainty: 1 - body.confidence,
      liquidityAvailable: body.availableLiquidity,
    })
  }
  stake = capStakeToLiquidity(stake, body.availableLiquidity, riskSettingsRow.max_liquidity_consumption_pct)
  if (stake <= 0) {
    return NextResponse.json({ success: true, decision: 'NO_BET', reasons: ['Computed stake is 0 (no qualifying edge, or bankroll/liquidity too small)'] })
  }

  const snapshot: MarketSnapshot = {
    marketId: body.marketId,
    selectionId: body.selectionId,
    status: 'OPEN',
    bestAvailablePrice: body.currentBestPrice,
    availableSize: body.availableLiquidity,
    priceAgeSeconds: 0,
  }
  const provider = new SimulationExecutionProvider(async () => snapshot)
  const minAcceptableOdds = body.minAcceptableOdds ?? body.currentBestPrice
  const order = await provider.placeOrder({ marketId: body.marketId, selectionId: body.selectionId, side: 'BACK', price: body.currentBestPrice, size: stake, minAcceptablePrice: minAcceptableOdds })

  if (order.status === 'REJECTED' || order.status === 'UNMATCHED') {
    return NextResponse.json({ success: true, decision: 'NO_BET', reasons: [order.rejectionReason ?? 'Order unmatched'] })
  }

  const idempotencyKey = `sim:${body.marketId}:${body.selectionId}:${Math.floor(Date.now() / 5000)}`
  const result = await placeSimulatedBet(admin, {
    marketId: body.marketId,
    selectionId: body.selectionId,
    runnerName: body.runnerName,
    racingCode: body.racingCode,
    venue: body.venue ?? null,
    raceNumber: body.raceNumber ?? null,
    state: body.state ?? null,
    jumpTime: body.jumpTime ?? null,
    requestedOdds: body.currentBestPrice,
    minAcceptableOdds,
    matchedOdds: order.averageMatchedPrice,
    requestedStake: stake,
    matchedStake: order.matchedSize,
    unmatchedStake: order.unmatchedSize,
    status: order.status as 'MATCHED' | 'PARTIALLY_MATCHED',
    betfairBetId: order.betId,
    modelProbability: body.modelProbability,
    marketProbability,
    fairOdds,
    stakingMethod: method,
    rawEdgePct,
    commissionAdjustedEdgePct: commissionAdjustedEv * 100,
    confidence: body.confidence,
    liquidityAvailable: body.availableLiquidity,
    marketBaseRate: body.marketBaseRate,
    modelVersion: body.modelVersion,
    featureVersion: body.featureVersion ?? null,
    bankrollBefore: bankrollAvailable,
    idempotencyKey,
    placement: body.stakeOverride != null ? 'MANUAL' : 'AUTOMATIC',
  })

  if (!result.placed) {
    return NextResponse.json({ success: false, message: 'This bet was already placed (duplicate detected)' }, { status: 409 })
  }
  return NextResponse.json({ success: true, decision: 'BET', betId: result.betId, stake: order.matchedSize, status: order.status })
}
