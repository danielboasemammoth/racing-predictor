import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRiskSettings, updateRiskSettings, writeAuditLog } from '@/lib/betfair/repository'

export async function GET() {
  const admin = createAdminClient()
  const settings = await getRiskSettings(admin)
  return NextResponse.json({ success: true, settings })
}

/** Full risk-settings payload replace (simplest, safest contract - the settings panel always submits the whole form). */
export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ success: false, message: 'Invalid body' }, { status: 400 })

  const admin = createAdminClient()
  const existing = await getRiskSettings(admin)

  const patch: Record<string, unknown> = {}
  const fieldMap: Record<string, string> = {
    minConfidence: 'min_confidence',
    minEdgePct: 'min_edge_pct',
    minExpectedValue: 'min_expected_value',
    minOdds: 'min_odds',
    maxOdds: 'max_odds',
    minLiquidity: 'min_liquidity',
    maxLiquidityConsumptionPct: 'max_liquidity_consumption_pct',
    maxBet: 'max_bet',
    maxPctBankroll: 'max_pct_bankroll',
    maxTotalExposurePct: 'max_total_exposure_pct',
    maxDailyStake: 'max_daily_stake',
    maxDailyLossPct: 'max_daily_loss_pct',
    maxBetsPerDay: 'max_bets_per_day',
    maxBetsPerRace: 'max_bets_per_race',
    minMinutesToJump: 'min_minutes_to_jump',
    maxMinutesToJump: 'max_minutes_to_jump',
    permittedCodes: 'permitted_codes',
    permittedStates: 'permitted_states',
    horseEnabled: 'horse_enabled',
    greyhoundEnabled: 'greyhound_enabled',
    nswThoroughbredAutoEnabled: 'nsw_thoroughbred_auto_enabled',
    stakingMethod: 'staking_method',
    flatStakeAmount: 'flat_stake_amount',
    pctBankrollStake: 'pct_bankroll_stake',
    orderTransactionHourlyCeiling: 'order_transaction_hourly_ceiling',
  }
  for (const [camel, snake] of Object.entries(fieldMap)) {
    if (body[camel] !== undefined) patch[snake] = body[camel]
  }

  const updated = await updateRiskSettings(admin, existing.id, patch)
  await writeAuditLog(admin, 'risk_settings_changed', existing, updated, null, 'admin')
  return NextResponse.json({ success: true, settings: updated })
}
