/**
 * One-off experiment: does a horse's PRIOR history of beating/missing market expectations
 * (averageMarketResidual, computed only from starts before the race in question - no
 * look-ahead) predict anything incremental beyond what that horse's OWN current-race market
 * price already implies? Chronological 85/15 discovery/holdout split; the bucketing threshold
 * is chosen on discovery only, the actual generalization check runs on the untouched holdout.
 * Read-only.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { extractBestWinOdds } from '../src/lib/roi-analysis'
import { averageMarketResidual, type MarketAdjustedStart } from '../src/lib/market-adjusted-form'
import { marketImpliedProbability } from '../src/lib/reliability-analysis'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface StartRow {
  horseId: string
  raceDatetime: string
  finishingPosition: number | null
  startingPrice: number | null
  status: string
}

async function main() {
  const races: Array<{ id: string; race_datetime: string }> = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('races').select('id, race_datetime').eq('status', 'completed').range(offset, offset + 999)
    if (error) throw error
    races.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const raceDatetimeById = new Map(races.map((race) => [race.id, race.race_datetime]))
  const raceIds = races.map((race) => race.id)
  console.log(`Loaded ${raceIds.length} completed races`)

  const startsByHorse = new Map<string, StartRow[]>()
  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const { data, error } = await supabase
      .from('race_entries')
      .select('race_id, horse_id, finishing_position, status, sectional_times')
      .in('race_id', chunk)
    if (error) throw error
    for (const entry of (data ?? []) as Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string; sectional_times: unknown }>) {
      const raceDatetime = raceDatetimeById.get(entry.race_id)
      if (!raceDatetime) continue
      const list = startsByHorse.get(entry.horse_id) ?? []
      list.push({
        horseId: entry.horse_id,
        raceDatetime,
        finishingPosition: entry.finishing_position,
        startingPrice: extractBestWinOdds(entry.sectional_times),
        status: entry.status,
      })
      startsByHorse.set(entry.horse_id, list)
    }
  }

  // For each start (with at least 3 priced prior starts), compute the prior residual (time-safe)
  // and this start's own market-implied probability, then check if actual outcome beats the
  // market MORE when the prior residual was positive than when it was negative.
  interface Row { raceDatetime: string; priorResidual: number; ownImpliedProbability: number; won: boolean }
  const rows: Row[] = []
  for (const starts of startsByHorse.values()) {
    const priced = starts
      .filter((start) => start.status !== 'scratched' && start.startingPrice)
      .sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
    for (let index = 0; index < priced.length; index += 1) {
      const prior = priced.slice(0, index).reverse() as MarketAdjustedStart[] // most-recent-first
      if (prior.length < 3) continue
      const residual = averageMarketResidual(prior)
      const current = priced[index]
      if (residual === null || !current.startingPrice) continue
      rows.push({
        raceDatetime: current.raceDatetime,
        priorResidual: residual,
        ownImpliedProbability: marketImpliedProbability(current.startingPrice),
        won: current.finishingPosition === 1,
      })
    }
  }
  rows.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
  console.log(`Rows with >=3 priced prior starts: ${rows.length}`)

  const validationEnd = Math.floor(rows.length * 0.85)
  const discovery = rows.slice(0, validationEnd)
  const holdout = rows.slice(validationEnd)

  // Pick the discovery-slice median residual as the positive/negative split point.
  const sortedResiduals = [...discovery.map((row) => row.priorResidual)].sort((a, b) => a - b)
  const median = sortedResiduals[Math.floor(sortedResiduals.length / 2)]
  console.log(`Discovery median prior residual: ${median.toFixed(4)}`)

  function summarize(label: string, subset: Row[]) {
    if (!subset.length) {
      console.log(`  ${label}: n=0`)
      return
    }
    const actualWinRate = subset.filter((row) => row.won).length / subset.length
    const avgImplied = subset.reduce((sum, row) => sum + row.ownImpliedProbability, 0) / subset.length
    console.log(`  ${label}: n=${subset.length}, actual win rate=${(actualWinRate * 100).toFixed(1)}%, avg market-implied=${(avgImplied * 100).toFixed(1)}%, residual=${((actualWinRate - avgImplied) * 100).toFixed(1)}pts`)
  }

  console.log('\nHoldout generalization check (residual = actual win rate minus what the CURRENT race\'s own price already implies):')
  summarize('Above-median prior residual (history of beating the market)', holdout.filter((row) => row.priorResidual > median))
  summarize('Below-median prior residual (history of missing the market)', holdout.filter((row) => row.priorResidual <= median))
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
