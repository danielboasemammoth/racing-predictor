import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWhatIf, type HistoricalBetRecord, type WhatIfRules } from '@/lib/betting/what-if'
import type { ConfidenceLevel } from '@/lib/betting/confidence'
import type { StakingMethod } from '@/lib/betting/kelly'
import type { BetResult } from '@/lib/betting/paper-wallet'

const VALID_CONFIDENCE: ConfidenceLevel[] = ['VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']
const VALID_STAKING: StakingMethod[] = ['flat-1pct', 'flat-2pct', 'kelly-0.10', 'kelly-0.25']

/**
 * SIMULATION LAB: recomputes historical paper-bet performance under different rules without
 * touching the original bet records - see src/lib/betting/what-if.ts.
 */
export async function GET(request: Request) {
  const admin = createAdminClient()
  const { searchParams } = new URL(request.url)

  const account = await admin.from('paper_accounts').select('id, starting_bankroll').eq('name', 'default').maybeSingle()
  if (account.error) return NextResponse.json({ success: false, message: account.error.message }, { status: 500 })
  if (!account.data) return NextResponse.json({ success: true, exists: false })

  const settled = await admin
    .from('paper_bets')
    .select('placed_at, stake, tab_decimal_odds, model_probability, edge_points, confidence_level, category, status')
    .eq('account_id', account.data.id)
    .in('status', ['WON', 'LOST', 'VOID', 'SCRATCHED', 'ABANDONED'])
    .order('placed_at', { ascending: true })
  if (settled.error) return NextResponse.json({ success: false, message: settled.error.message }, { status: 500 })

  const bets: HistoricalBetRecord[] = (settled.data ?? []).map((b) => ({
    placedAt: b.placed_at as string,
    decimalOdds: b.tab_decimal_odds as number,
    modelProbability: b.model_probability as number,
    edgePoints: b.edge_points as number | null,
    confidenceLevel: b.confidence_level as ConfidenceLevel | null,
    category: b.category as HistoricalBetRecord['category'],
    result: b.status as Exclude<BetResult, 'PENDING'>,
    originalStake: b.stake as number,
  }))

  const minConfidenceLevel = searchParams.get('minConfidenceLevel')
  const minEdgePoints = searchParams.get('minEdgePoints')
  const minOdds = searchParams.get('minOdds')
  const maxOdds = searchParams.get('maxOdds')
  const categories = searchParams.get('categories')
  const stakingMethod = searchParams.get('stakingMethod')

  const rules: WhatIfRules = {
    minConfidenceLevel: minConfidenceLevel && VALID_CONFIDENCE.includes(minConfidenceLevel as ConfidenceLevel) ? (minConfidenceLevel as ConfidenceLevel) : undefined,
    minEdgePoints: minEdgePoints ? Number(minEdgePoints) : undefined,
    minOdds: minOdds ? Number(minOdds) : undefined,
    maxOdds: maxOdds ? Number(maxOdds) : undefined,
    categories: categories ? (categories.split(',') as HistoricalBetRecord['category'][]) : undefined,
    stakingMethod: stakingMethod && VALID_STAKING.includes(stakingMethod as StakingMethod) ? (stakingMethod as StakingMethod) : undefined,
  }

  const stats = runWhatIf(account.data.starting_bankroll as number, bets, rules)
  return NextResponse.json({ success: true, exists: true, totalHistoricalBets: bets.length, rules, stats })
}
