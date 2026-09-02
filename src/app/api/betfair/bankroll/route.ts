import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBankrollConfig, updateBankrollConfig, writeAuditLog } from '@/lib/betfair/repository'

/** Bankroll allocation config - NEVER a deposit/withdrawal mechanism, purely an app-level risk boundary (see BANKROLL_AND_STAKING.md). */
export async function GET() {
  const admin = createAdminClient()
  const config = await getBankrollConfig(admin)
  return NextResponse.json({ success: true, config })
}

export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    actualBetfairBalance?: number | null
    allocatedBankroll?: number
    reserveBalance?: number
    maxAutomationPct?: number
    bankrollCeiling?: number | null
    withdrawalThreshold?: number | null
    topupThreshold?: number | null
    simulatedStartingBankroll?: number
  } | null
  if (!body) return NextResponse.json({ success: false, message: 'Invalid body' }, { status: 400 })

  const admin = createAdminClient()
  const existing = await getBankrollConfig(admin)

  const patch: Record<string, unknown> = {}
  if (body.actualBetfairBalance !== undefined) patch.actual_betfair_balance = body.actualBetfairBalance
  if (body.allocatedBankroll !== undefined) patch.allocated_bankroll = body.allocatedBankroll
  if (body.reserveBalance !== undefined) patch.reserve_balance = body.reserveBalance
  if (body.maxAutomationPct !== undefined) patch.max_automation_pct = body.maxAutomationPct
  if (body.bankrollCeiling !== undefined) patch.bankroll_ceiling = body.bankrollCeiling
  if (body.withdrawalThreshold !== undefined) patch.withdrawal_threshold = body.withdrawalThreshold
  if (body.topupThreshold !== undefined) patch.topup_threshold = body.topupThreshold
  if (body.simulatedStartingBankroll !== undefined) {
    // Rebase, same non-destructive convention as the PuntersEdge paper-betting bankroll: preserve net profit/loss.
    const netProfit = existing.simulated_current_bankroll - existing.simulated_starting_bankroll
    patch.simulated_starting_bankroll = body.simulatedStartingBankroll
    patch.simulated_current_bankroll = body.simulatedStartingBankroll + netProfit
  }

  const updated = await updateBankrollConfig(admin, existing.id, patch)
  await writeAuditLog(admin, 'bankroll_config_changed', existing, updated, null, 'admin')
  return NextResponse.json({ success: true, config: updated })
}
