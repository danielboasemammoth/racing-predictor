import type { SupabaseClient } from '@supabase/supabase-js'
import { computeWalletStats, type WalletBetForStats } from '@/lib/betting/paper-wallet'
import { brierScore, bucketCalibration, credibleBuckets, logLoss, type CalibrationSample } from '@/lib/betting/calibration'

const WINDOW_SIZES = [20, 50, 100, 250, 500] as const

export interface ValidationWindow {
  label: string
  n: number
  winRate: number | null
  roiPct: number
  netProfit: number
  maxDrawdownPct: number
}

export interface ValidationReport {
  totalSettled: number
  windows: ValidationWindow[]
  calibration: {
    buckets: ReturnType<typeof bucketCalibration>
    credibleBuckets: ReturnType<typeof bucketCalibration>
    brierScore: number | null
    logLoss: number | null
  }
}

/** Shared MODEL VALIDATION computation used by /api/paper-betting/validation and the /paper-betting page. */
export async function computeValidationReport(supabase: SupabaseClient, accountId: string): Promise<ValidationReport> {
  const settled = await supabase
    .from('paper_bets')
    .select('stake, tab_decimal_odds, edge_points, model_probability, status, profit, placed_at')
    .eq('account_id', accountId)
    .in('status', ['WON', 'LOST'])
    .order('placed_at', { ascending: true })
  if (settled.error) throw settled.error

  const bets = settled.data ?? []

  const windows: ValidationWindow[] = [...WINDOW_SIZES, Number.POSITIVE_INFINITY].map((size) => {
    const slice = Number.isFinite(size) ? bets.slice(-size) : bets
    const asWalletBets: WalletBetForStats[] = slice.map((b) => ({
      stake: b.stake as number,
      decimalOdds: b.tab_decimal_odds as number,
      edgePoints: b.edge_points as number | null,
      result: b.status as WalletBetForStats['result'],
      profit: b.profit as number | null,
    }))
    const stats = computeWalletStats(0, asWalletBets)
    return {
      label: Number.isFinite(size) ? `Last ${size}` : 'All bets',
      n: slice.length,
      winRate: stats.winRate,
      roiPct: stats.roiPct,
      netProfit: stats.netProfit,
      maxDrawdownPct: stats.maxDrawdownPct,
    }
  })

  const calibrationSamples: CalibrationSample[] = bets.map((b) => ({ modelProbability: b.model_probability as number, won: b.status === 'WON' }))
  const buckets = bucketCalibration(calibrationSamples)

  return {
    totalSettled: bets.length,
    windows,
    calibration: {
      buckets,
      credibleBuckets: credibleBuckets(buckets),
      brierScore: brierScore(calibrationSamples),
      logLoss: logLoss(calibrationSamples),
    },
  }
}
