import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAutomationState, updateAutomationState, writeAuditLog } from '@/lib/betfair/repository'

export async function GET() {
  const admin = createAdminClient()
  const state = await getAutomationState(admin)
  return NextResponse.json({ success: true, state })
}

/**
 * Mode/automation switch. LIVE modes are accepted here for Stage 1 only as UI plumbing - there is
 * no BetfairExecutionProvider wired up yet, so nothing can actually submit a real order regardless
 * of this switch (see LIVE_BETTING_ACTIVATION_CHECKLIST in LIVE_BETTING_RUNBOOK.md, none of which
 * is satisfied yet). `emergencyStop: true` immediately forces mode back to SIMULATION and disables
 * automation, regardless of what else is in the request body.
 */
export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    mode?: 'SIMULATION' | 'LIVE_MANUAL' | 'LIVE_AUTO'
    liveBettingEnabled?: boolean
    emergencyStop?: boolean
    reason?: string
  } | null
  if (!body) return NextResponse.json({ success: false, message: 'Invalid body' }, { status: 400 })

  const admin = createAdminClient()
  const existing = await getAutomationState(admin)

  if (body.emergencyStop) {
    const updated = await updateAutomationState(admin, existing.id, { mode: 'SIMULATION', live_betting_enabled: false, paused_reason: body.reason ?? 'Emergency stop' }, 'admin')
    await writeAuditLog(admin, 'emergency_stop', existing, updated, body.reason ?? null, 'admin')
    return NextResponse.json({ success: true, state: updated, message: 'Live automated betting stopped. Existing matched bets are unaffected - cancel unmatched orders separately if needed.' })
  }

  const patch: Record<string, unknown> = {}
  if (body.mode !== undefined) patch.mode = body.mode
  if (body.liveBettingEnabled !== undefined) {
    if (body.liveBettingEnabled) {
      // Stage 1: always fail-closed, since no BetfairExecutionProvider/credentials exist yet.
      return NextResponse.json(
        { success: false, message: 'Live betting cannot be enabled yet - Betfair API credentials are not configured (Stage 2+ requirement). See LIVE_BETTING_RUNBOOK.md checklist.' },
        { status: 400 },
      )
    }
    patch.live_betting_enabled = false
  }

  const updated = await updateAutomationState(admin, existing.id, patch, 'admin')
  await writeAuditLog(admin, 'automation_state_changed', existing, updated, body.reason ?? null, 'admin')
  return NextResponse.json({ success: true, state: updated })
}
