import type { SupabaseClient } from '@supabase/supabase-js'
import { loadReliabilityContext } from './reliability-context'
import { reliabilityCalibrationBands } from './reliability-score'
import { compareBaselines } from './baseline-comparison'
import { extractBestWinOdds } from './roi-analysis'

interface PricedEntry {
  race_id: string
  finishing_position: number | null
  status: string
  starting_price: number | null
  sectional_times: unknown
}

export async function loadAnalyticsSnapshot(db: SupabaseClient) {
  const context = await loadReliabilityContext(db, true)
  if (!context) throw new Error('Reliability context unavailable')
  const entriesByRace = new Map<string, PricedEntry[]>()
  const raceIds = [...new Set(context.history.map(row => row.raceId))]
  for (let offset = 0; offset < raceIds.length; offset += 100) {
    for (let page = 0; ; page += 1000) {
      const { data, error } = await db.from('race_entries')
        .select('race_id, finishing_position, status, starting_price, sectional_times')
        .in('race_id', raceIds.slice(offset, offset + 100)).order('id').range(page, page + 999)
      if (error) throw error
      for (const entry of (data ?? []) as PricedEntry[]) {
        const entries = entriesByRace.get(entry.race_id) ?? []
        entries.push(entry)
        entriesByRace.set(entry.race_id, entries)
      }
      if (!data || data.length < 1000) break
    }
  }
  const baselines = compareBaselines(context.history.map(row => {
    const priced = (entriesByRace.get(row.raceId) ?? []).filter(entry => entry.status !== 'scratched')
      .map(entry => ({ ...entry, price: entry.starting_price ?? extractBestWinOdds(entry.sectional_times) }))
      .filter((entry): entry is PricedEntry & { price: number } => entry.price !== null)
    const favourite = priced.length ? priced.reduce((lowest, entry) => entry.price < lowest.price ? entry : lowest) : null
    return {
      favouritePrice: favourite?.price ?? null,
      favouriteWon: favourite?.finishing_position === 1,
      modelPickPrice: row.bestRecordedOdds ?? null,
      modelPickWon: row.correctWinner,
    }
  }))
  const feature = await db.from('analysis_snapshots').select('payload').eq('kind', 'feature-ablation').maybeSingle()
  if (feature.error) throw feature.error
  const bands = reliabilityCalibrationBands(
    context.history.filter((row): row is typeof row & { probability: number; gap: number; agreeing: number; totalBaseModels: number } =>
      typeof row.probability === 'number' && typeof row.gap === 'number' && typeof row.agreeing === 'number' && typeof row.totalBaseModels === 'number'),
    context.calibration, context.history,
  ).map(band => ({
    ...band,
    shrunkStrikeRate: band.strikeRate,
    baseline: context.calibration.overallBaseline,
    lift: band.strikeRate - context.calibration.overallBaseline,
    significant: band.n >= 30 && (band.ciLow > context.calibration.overallBaseline || band.ciHigh < context.calibration.overallBaseline),
  }))
  return {
    historyCount: context.history.length, calibration: context.calibration, bands, baselines,
    featureImportance: (feature.data?.payload ?? null) as { generatedAt: string; racesEvaluated: number; featureImportance: Array<{ label: string; deltaVsFull: number }> } | null,
  }
}

export type AnalyticsSnapshot = Awaited<ReturnType<typeof loadAnalyticsSnapshot>>