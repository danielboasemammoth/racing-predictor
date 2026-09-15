import type { SupabaseClient } from '@supabase/supabase-js'
import { computeWalletStats, type WalletBetForStats } from '@/lib/betting/paper-wallet'
import { brierScore, bucketCalibration, credibleBuckets, logLoss, type CalibrationSample } from '@/lib/betting/calibration'
import { detectDrift, type DriftBetSample, type DriftReport } from '@/lib/betting/drift-detection'

const WINDOW_SIZES = [20, 50, 100, 250, 500] as const
const DRIFT_RECENT_WINDOW_SIZE = 50

export interface ValidationBet {
  stake: number
  tab_decimal_odds: number
  edge_points: number | null
  model_probability: number
  status: 'WON' | 'LOST'
  profit: number | null
  placed_at: string
  bet_type: 'WIN' | 'PLACE'
  race_id: string
  source: string
  mode: string
  model_version: string
  policy_version?: string | null
}

export function policyPerformance(bets: ValidationBet[]) {
  const groups = new Map<string, ValidationBet[]>()
  for (const bet of bets) {
    const key = JSON.stringify([bet.policy_version ?? 'untagged', bet.source, bet.mode, bet.model_version])
    const group = groups.get(key) ?? []
    group.push(bet)
    groups.set(key, group)
  }
  return [...groups.values()].map((rows) => ({
    policyVersion: rows[0].policy_version ?? 'untagged',
    source: rows[0].source,
    mode: rows[0].mode,
    modelVersion: rows[0].model_version,
    markets: marketPerformance(rows).filter((market) => market.n > 0),
  }))
}

export async function loadValidationBets(supabase: SupabaseClient, accountId: string): Promise<ValidationBet[]> {
  const bets: ValidationBet[] = []
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from('paper_bets').select('*')
      .eq('account_id', accountId).in('status', ['WON', 'LOST'])
      .order('placed_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + 999)
    if (result.error) throw result.error
    const page = (result.data ?? []) as ValidationBet[]
    bets.push(...page)
    if (page.length < 1000) return bets
  }
}

export function marketPerformance(bets: ValidationBet[]) {
  return (['WIN', 'PLACE'] as const).flatMap((betType) => {
    const market = bets.filter((bet) => bet.bet_type === betType)
    return [false, true].map((highChanceValue) => {
      const selected = market.filter((bet) => !highChanceValue || (
        bet.model_probability >= 0.6 && bet.model_probability * bet.tab_decimal_odds > 1
      ))
      const stake = selected.reduce((sum, bet) => sum + bet.stake, 0)
      const profit = selected.reduce((sum, bet) => sum + (bet.profit ?? 0), 0)
      return {
        label: `${betType}${highChanceValue ? ' / chance >=60%, EV >0' : ' / all'}`,
        n: selected.length,
        races: new Set(selected.map((bet) => bet.race_id)).size,
        winRate: selected.length ? selected.filter((bet) => bet.status === 'WON').length / selected.length : null,
        expectedHitRate: selected.length ? selected.reduce((sum, bet) => sum + bet.model_probability, 0) / selected.length : null,
        expectedRoiPct: stake > 0 ? selected.reduce((sum, bet) => sum + bet.stake * (bet.model_probability * bet.tab_decimal_odds - 1), 0) / stake * 100 : null,
        roiPct: stake > 0 ? profit / stake * 100 : null,
        netProfit: profit,
      }
    })
  })
}

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
  markets: ReturnType<typeof marketPerformance>
  policies: ReturnType<typeof policyPerformance>
  windows: ValidationWindow[]
  calibration: {
    buckets: ReturnType<typeof bucketCalibration>
    credibleBuckets: ReturnType<typeof bucketCalibration>
    brierScore: number | null
    logLoss: number | null
  }
  drift: DriftReport
}

/** Shared MODEL VALIDATION computation used by /api/paper-betting/validation and the /paper-betting page. */
export async function computeValidationReport(supabase: SupabaseClient, accountId: string): Promise<ValidationReport> {
  const bets = await loadValidationBets(supabase, accountId)

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

  const driftSamples: DriftBetSample[] = bets.map((b) => ({
    modelProbability: b.model_probability as number,
    won: b.status === 'WON',
    profit: (b.profit as number) ?? 0,
    stake: b.stake as number,
    edgePoints: b.edge_points as number | null,
  }))
  const drift = detectDrift(driftSamples.slice(-DRIFT_RECENT_WINDOW_SIZE), driftSamples.slice(0, -DRIFT_RECENT_WINDOW_SIZE))

  return {
    totalSettled: bets.length,
    markets: marketPerformance(bets),
    policies: policyPerformance(bets),
    windows,
    calibration: {
      buckets,
      credibleBuckets: credibleBuckets(buckets),
      brierScore: brierScore(calibrationSamples),
      logLoss: logLoss(calibrationSamples),
    },
    drift,
  }
}
