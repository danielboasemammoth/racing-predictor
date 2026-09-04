import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPuntersEdgeClient } from '@/lib/puntersedge/client'
import { settleBet } from '@/lib/betting/paper-wallet'
import { getPendingBetsForRace, hasSettleableBets, settleBetInDb } from '@/lib/paper-betting/repository'

/**
 * Fetches FINAL results (never interim - placings can still change on protest) and settles every
 * matching PENDING paper bet. Matches on the runner's stable number within the race, never on
 * name. `placings` is just the finishing order (commonly top 4) and is NOT reliable for "did this
 * runner pay a place dividend" - e.g. greyhound racing standardly only pays 1st-2nd place
 * regardless of field size, so a 3rd/4th-place `placings` entry never has a PLC dividend line
 * (verified live 2026-09-04). A PLACE bet only wins if its runner has a `market: 'PLC'` line in
 * `dividends.straight`; a runner that is neither scratched nor place-dividend-paying on a FINAL
 * result definitively lost the place bet.
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
      const placeDividendNumbers = new Set(
        (result.dividends?.straight ?? []).filter((d) => d.market === 'PLC').map((d) => d.number),
      )

      for (const bet of pendingBets) {
        if (deductedNumbers.has(bet.runner_number)) {
          const { returnAmount, profit } = settleBet({ stake: bet.stake, decimalOdds: bet.tab_decimal_odds }, 'SCRATCHED')
          if (await settleBetInDb(admin, bet.id, 'SCRATCHED', returnAmount, profit)) settledCount += 1
          continue
        }

        const placing = placingByNumber.get(bet.runner_number)
        // WIN only wins for the actual winner; PLACE wins only if the runner actually paid a PLC dividend.
        const outcome = bet.bet_type === 'WIN' ? (placing?.position === 1 ? 'WON' : 'LOST') : placeDividendNumbers.has(bet.runner_number) ? 'WON' : 'LOST'
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
