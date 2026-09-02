import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPuntersEdgeClient } from '@/lib/puntersedge/client'
import { settleBet } from '@/lib/betting/paper-wallet'
import { getPendingBetsForRace, hasSettleableBets, settleBetInDb } from '@/lib/paper-betting/repository'

/**
 * Fetches FINAL results (never interim - placings can still change on protest) and settles every
 * matching PENDING paper bet. Matches on the runner's stable number within the race, never on
 * name. `placings` only contains the dividend-bearing placegetters for this field size (verified
 * against a live result) - a runner that is neither scratched nor in `placings` on a FINAL result
 * definitively finished outside the paid places, so WIN and PLACE bets on it settle LOST rather
 * than being left pending forever.
 *
 * Skips the PuntersEdge API call entirely (saving 2 credits) when there is no PENDING bet whose
 * race has jumped yet - most scheduled polls have nothing to settle, and each results() call costs
 * credits regardless of how many (if any) results it returns.
 */
export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  let hoursBack = 24
  try {
    const body: unknown = await request.json().catch(() => ({}))
    if (typeof body === 'object' && body !== null && 'hoursBack' in body && typeof (body as { hoursBack: unknown }).hoursBack === 'number') {
      hoursBack = (body as { hoursBack: number }).hoursBack
    }
  } catch {
    // default hoursBack
  }

  const admin = createAdminClient()
  const client = getPuntersEdgeClient()

  try {
    if (!(await hasSettleableBets(admin))) {
      return NextResponse.json({
        success: true,
        resultsChecked: 0,
        settledCount: 0,
        skippedNoPendingBets: 0,
        skippedApiCall: true,
        message: 'No pending bets past their jump time - skipped the PuntersEdge results call',
      })
    }

    const results = await client.results({ hoursBack, status: 'final', country: ['AU'] })

    let settledCount = 0
    let skippedNoPendingBets = 0

    for (const result of results) {
      const pendingBets = await getPendingBetsForRace(admin, result.race_id)
      if (pendingBets.length === 0) {
        skippedNoPendingBets += 1
        continue
      }

      const deductedNumbers = new Set((result.deductions ?? []).map((d) => d.number))
      const placingByNumber = new Map(result.placings.map((p) => [p.number, p]))

      for (const bet of pendingBets) {
        if (deductedNumbers.has(bet.runner_number)) {
          const { returnAmount, profit } = settleBet({ stake: bet.stake, decimalOdds: bet.tab_decimal_odds }, 'SCRATCHED')
          if (await settleBetInDb(admin, bet.id, 'SCRATCHED', returnAmount, profit)) settledCount += 1
          continue
        }

        const placing = placingByNumber.get(bet.runner_number)
        // WIN only wins for the actual winner; PLACE wins for any dividend-bearing placegetter.
        const outcome = bet.bet_type === 'WIN' ? (placing?.position === 1 ? 'WON' : 'LOST') : placing ? 'WON' : 'LOST'
        const { returnAmount, profit } = settleBet({ stake: bet.stake, decimalOdds: bet.tab_decimal_odds }, outcome)
        if (await settleBetInDb(admin, bet.id, outcome, returnAmount, profit)) settledCount += 1
      }
    }

    return NextResponse.json({
      success: true,
      resultsChecked: results.length,
      settledCount,
      skippedNoPendingBets,
      message: `Checked ${results.length} final result${results.length === 1 ? '' : 's'}, settled ${settledCount} paper bet${settledCount === 1 ? '' : 's'}`,
    })
  } catch (error) {
    console.error('PuntersEdge settlement failed', error)
    return NextResponse.json({ success: false, message: 'Paper bet settlement failed' }, { status: 500 })
  }
}
