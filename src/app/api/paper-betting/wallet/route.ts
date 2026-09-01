import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeWalletStats, type WalletBetForStats } from '@/lib/betting/paper-wallet'

/** Public read-only wallet summary for the default paper account, matching the rest of the site's read-access convention. */
export async function GET() {
  const admin = createAdminClient()

  const account = await admin.from('paper_accounts').select('*').eq('name', 'default').maybeSingle()
  if (account.error) {
    return NextResponse.json({ success: false, message: account.error.message }, { status: 500 })
  }
  if (!account.data) {
    return NextResponse.json({ success: true, exists: false })
  }

  const bets = await admin
    .from('paper_bets')
    .select('stake, tab_decimal_odds, edge_points, status, profit, placed_at')
    .eq('account_id', account.data.id)
    .order('placed_at', { ascending: true })
  if (bets.error) {
    return NextResponse.json({ success: false, message: bets.error.message }, { status: 500 })
  }

  const betsForStats: WalletBetForStats[] = (bets.data ?? []).map((b) => ({
    stake: b.stake as number,
    decimalOdds: b.tab_decimal_odds as number,
    edgePoints: b.edge_points as number | null,
    result: b.status as WalletBetForStats['result'],
    profit: b.profit as number | null,
  }))

  const stats = computeWalletStats(account.data.starting_bankroll as number, betsForStats)
  return NextResponse.json({ success: true, exists: true, account: account.data, stats })
}
