import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPuntersEdgeClient } from '@/lib/puntersedge/client'
import { settleBet } from '@/lib/betting/paper-wallet'
import { getPendingBetsForRace, settleBetInDb } from '@/lib/paper-betting/repository'

/**
 * Fetches FINAL results (never interim - placings can still change on protest) and settles every
 * matching PENDING paper bet. Matches on the runner's stable number within the race, never on
 * name. Runners in a race's `scratchings` are settled SCRATCHED (stake refunded); every other
 * pending bet on a race with no matching placing is left PENDING (result not yet available).
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
    const results = await client.results({ hoursBack, status: 'final', country: ['AU'] })

    let settledCount = 0
    let skippedNoPendingBets = 0

    for (const result of results) {
      const pendingBets = await getPendingBetsForRace(admin, result.race_id)
      if (pendingBets.length === 0) {
        skippedNoPendingBets += 1
        continue
      }

      const scratchedNumbers = new Set((result.scratchings ?? []).map((s) => s.number))
      const placingByNumber = new Map(result.placings.map((p) => [p.number, p]))

      for (const bet of pendingBets) {
        if (bet.bet_type !== 'WIN') continue // PLACE settlement not yet implemented - see report

        if (scratchedNumbers.has(bet.runner_number)) {
          const { returnAmount, profit } = settleBet({ stake: bet.stake, decimalOdds: bet.tab_decimal_odds }, 'SCRATCHED')
          if (await settleBetInDb(admin, bet.id, 'SCRATCHED', returnAmount, profit)) settledCount += 1
          continue
        }

        const placing = placingByNumber.get(bet.runner_number)
        if (!placing) continue // no placing and not scratched - result incomplete, leave PENDING

        const outcome = placing.position === 1 ? 'WON' : 'LOST'
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
