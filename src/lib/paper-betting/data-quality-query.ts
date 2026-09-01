import type { SupabaseClient } from '@supabase/supabase-js'

const STALE_PRICE_SECONDS = 120

export interface ApiBudgetReport {
  creditsUsed: number
  creditsRemaining: number
  periodStart: string
  nextResetAt: string
  checkedAt: string
  dailyBurnRate: number | null
  projectedDaysUntilExhausted: number | null
}

export interface DataQualityReport {
  apiBudget: ApiBudgetReport | null
  recentRecommendations: {
    total: number
    missingTabPrice: number
    stalePrices: number
  }
  racesByStatus: Record<string, number>
  pendingBets: {
    count: number
    oldestPlacedAt: string | null
  }
}

/** DATA QUALITY DASHBOARD + API COST CONTROL: diagnostics for the admin panel, not the public site. */
export async function computeDataQualityReport(admin: SupabaseClient): Promise<DataQualityReport> {
  const [usageRow, recentRecs, racesByStatusRows, pendingCount, oldestPendingBet] = await Promise.all([
    admin.from('pe_api_usage').select('*').order('checked_at', { ascending: false }).limit(1).maybeSingle(),
    admin
      .from('pe_recommendations')
      .select('tab_win_price, tab_age_seconds')
      .gte('generated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString()),
    admin.from('pe_races').select('status'),
    admin.from('paper_bets').select('*', { count: 'exact', head: true }).eq('status', 'PENDING'),
    admin.from('paper_bets').select('placed_at').eq('status', 'PENDING').order('placed_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  if (usageRow.error) throw usageRow.error
  if (recentRecs.error) throw recentRecs.error
  if (racesByStatusRows.error) throw racesByStatusRows.error
  if (pendingCount.error) throw pendingCount.error
  if (oldestPendingBet.error) throw oldestPendingBet.error

  let apiBudget: ApiBudgetReport | null = null
  if (usageRow.data) {
    const periodStart = new Date(usageRow.data.period_start as string)
    const daysElapsed = Math.max(1, (Date.now() - periodStart.getTime()) / (24 * 60 * 60 * 1000))
    const dailyBurnRate = (usageRow.data.credits_used as number) / daysElapsed
    apiBudget = {
      creditsUsed: usageRow.data.credits_used as number,
      creditsRemaining: usageRow.data.credits_remaining as number,
      periodStart: usageRow.data.period_start as string,
      nextResetAt: usageRow.data.next_reset_at as string,
      checkedAt: usageRow.data.checked_at as string,
      dailyBurnRate,
      projectedDaysUntilExhausted: dailyBurnRate > 0 ? (usageRow.data.credits_remaining as number) / dailyBurnRate : null,
    }
  }

  const recs = recentRecs.data ?? []
  const racesByStatus: Record<string, number> = {}
  for (const row of racesByStatusRows.data ?? []) {
    const status = row.status as string
    racesByStatus[status] = (racesByStatus[status] ?? 0) + 1
  }

  return {
    apiBudget,
    recentRecommendations: {
      total: recs.length,
      missingTabPrice: recs.filter((r) => r.tab_win_price == null).length,
      stalePrices: recs.filter((r) => r.tab_age_seconds != null && r.tab_age_seconds > STALE_PRICE_SECONDS).length,
    },
    racesByStatus,
    pendingBets: {
      count: pendingCount.count ?? 0,
      oldestPlacedAt: oldestPendingBet.data?.placed_at ?? null,
    },
  }
}
