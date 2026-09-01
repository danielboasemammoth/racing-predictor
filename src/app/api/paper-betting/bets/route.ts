import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrCreateAccount, placeBet } from '@/lib/paper-betting/repository'
import { recommendedStake, type StakingMethod } from '@/lib/betting/kelly'

const DEFAULT_STARTING_BANKROLL = 500

export async function GET(request: Request) {
  const admin = createAdminClient()
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const category = searchParams.get('category')
  const limit = Math.min(500, Number(searchParams.get('limit') ?? '100'))

  let query = admin
    .from('paper_bets')
    .select('*, pe_races(venue, race_number, category, start_time)')
    .order('placed_at', { ascending: false })
    .limit(limit)
  if (status) query = query.eq('status', status)
  if (category) query = query.eq('category', category)

  const { data, error } = await query
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  return NextResponse.json({ success: true, bets: data ?? [] })
}

/** Manual "PAPER BET" action - gated the same as every other write on this site (admin session). */
export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    raceId?: string
    runnerId?: string
    runnerName?: string
    category?: 'horse' | 'greyhound' | 'harness'
    tabDecimalOdds?: number
    modelProbability?: number
    modelVersion?: string
    edgePoints?: number | null
    expectedValue?: number | null
    confidenceLevel?: string | null
    minutesToJump?: number
    stakeOverride?: number
  } | null

  if (!body?.raceId || !body.runnerId || !body.runnerName || !body.category || !body.tabDecimalOdds || body.modelProbability == null || !body.modelVersion) {
    return NextResponse.json({ success: false, message: 'Missing required bet fields' }, { status: 400 })
  }
  if (body.tabDecimalOdds <= 1) {
    return NextResponse.json({ success: false, message: 'Invalid TAB price' }, { status: 400 })
  }

  const admin = createAdminClient()
  const account = await getOrCreateAccount(admin, 'default', DEFAULT_STARTING_BANKROLL)

  const stake =
    body.stakeOverride ??
    recommendedStake(account.staking_method as StakingMethod, account.current_bankroll, body.tabDecimalOdds, body.modelProbability)
  if (stake <= 0) {
    return NextResponse.json({ success: false, message: 'Computed stake is 0 - no qualifying edge or bankroll too small for the minimum stake' }, { status: 400 })
  }

  const result = await placeBet(admin, {
    accountId: account.id,
    raceId: body.raceId,
    runnerId: body.runnerId,
    runnerName: body.runnerName,
    category: body.category,
    mode: 'MANUAL',
    betType: 'WIN',
    stake,
    tabDecimalOdds: body.tabDecimalOdds,
    modelProbability: body.modelProbability,
    modelVersion: body.modelVersion,
    edgePoints: body.edgePoints ?? null,
    expectedValue: body.expectedValue ?? null,
    confidenceLevel: body.confidenceLevel ?? null,
    minutesToJumpAtPlacement: body.minutesToJump ?? 0,
    // 5-second bucket: blocks an accidental double-click on the same runner, still allows a
    // deliberate second manual bet on the same runner later.
    idempotencyKey: `manual:${body.raceId}:${body.runnerId}:${Math.floor(Date.now() / 5000)}`,
  })

  if (!result.placed) {
    return NextResponse.json({ success: false, message: 'This bet was already placed' }, { status: 409 })
  }
  return NextResponse.json({ success: true, betId: result.betId, stake })
}
