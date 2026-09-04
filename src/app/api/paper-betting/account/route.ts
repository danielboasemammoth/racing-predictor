import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateAccount, resetAccount, updateStartingBankroll } from '@/lib/paper-betting/repository'
import type { StakingMethod } from '@/lib/betting/kelly'

const ACCOUNT_NAME = 'default'
const VALID_STAKING_METHODS: StakingMethod[] = ['flat-1pct', 'flat-2pct', 'kelly-0.10', 'kelly-0.25']

/** Public read: current account settings + how many bets already exist (so the UI can decide whether to offer a plain edit or require an explicit reset). */
export async function GET() {
  const admin = createAdminClient()
  const account = await admin.from('paper_accounts').select('*').eq('name', ACCOUNT_NAME).maybeSingle()
  if (account.error) return NextResponse.json({ success: false, message: account.error.message }, { status: 500 })
  if (!account.data) return NextResponse.json({ success: true, exists: false })

  const betCount = await admin.from('paper_bets').select('*', { count: 'exact', head: true }).eq('account_id', account.data.id)
  if (betCount.error) return NextResponse.json({ success: false, message: betCount.error.message }, { status: 500 })

  return NextResponse.json({ success: true, exists: true, account: account.data, betCount: betCount.count ?? 0 })
}

/**
 * Configures the starting bankroll (spec: "choose my starting budget"). Creates the account if it
 * doesn't exist yet; otherwise rebases starting_bankroll (preserving net profit/loss) unless
 * `reset: true` is explicitly passed, which also deletes all bet history - destructive, requires
 * the caller to have already confirmed with the user.
 */
export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { startingBankroll?: number; reset?: boolean; stakingMethod?: string } | null
  if (!body?.startingBankroll || body.startingBankroll <= 0) {
    return NextResponse.json({ success: false, message: 'startingBankroll must be a positive number' }, { status: 400 })
  }
  if (body.stakingMethod !== undefined && !VALID_STAKING_METHODS.includes(body.stakingMethod as StakingMethod)) {
    return NextResponse.json({ success: false, message: `stakingMethod must be one of ${VALID_STAKING_METHODS.join(', ')}` }, { status: 400 })
  }

  const admin = createAdminClient()
  const existing = await admin.from('paper_accounts').select('*').eq('name', ACCOUNT_NAME).maybeSingle()
  if (existing.error) return NextResponse.json({ success: false, message: existing.error.message }, { status: 500 })

  try {
    if (!existing.data) {
      const account = await getOrCreateAccount(admin, ACCOUNT_NAME, body.startingBankroll, body.stakingMethod)
      return NextResponse.json({ success: true, account, message: `Created paper betting account with a $${body.startingBankroll.toFixed(2)} starting budget` })
    }
    if (body.reset) {
      const account = await resetAccount(admin, existing.data.id as string, body.startingBankroll, body.stakingMethod)
      return NextResponse.json({ success: true, account, message: `Reset paper betting account: all bet history cleared, new $${body.startingBankroll.toFixed(2)} starting budget` })
    }
    const account = await updateStartingBankroll(admin, existing.data.id as string, body.startingBankroll, body.stakingMethod)
    return NextResponse.json({ success: true, account, message: `Starting budget updated to $${body.startingBankroll.toFixed(2)} (existing profit/loss preserved)` })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to configure paper betting account'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
