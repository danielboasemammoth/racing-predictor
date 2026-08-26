/**
 * One-off experiment: does a horse's PRIOR form trend (computed time-safe, from strictly earlier
 * starts) predict its NEXT result beyond what a plain recency-weighted average already captures?
 * Chronological 85/15 split; only the direction/magnitude found on discovery is reported, the
 * actual generalization check runs on the untouched holdout. Read-only.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { resultScore } from '../src/lib/prediction-v3'
import { formTrend } from '../src/lib/form-trajectory'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface StartRow {
  horseId: string
  raceDatetime: string
  finishingPosition: number | null
  fieldSize: number
  margin: number | null
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

  const entriesByRace = new Map<string, Array<{ horse_id: string; finishing_position: number | null; status: string; margin: number | null }>>()
  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const { data, error } = await supabase.from('race_entries').select('race_id, horse_id, finishing_position, status, margin').in('race_id', chunk)
    if (error) throw error
    for (const entry of (data ?? []) as Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string; margin: number | null }>) {
      const list = entriesByRace.get(entry.race_id) ?? []
      list.push(entry)
      entriesByRace.set(entry.race_id, list)
    }
  }

  const startsByHorse = new Map<string, StartRow[]>()
  for (const [raceId, entries] of entriesByRace) {
    const raceDatetime = raceDatetimeById.get(raceId)
    if (!raceDatetime) continue
    const fieldSize = entries.filter((entry) => entry.status !== 'scratched').length
    for (const entry of entries) {
      const list = startsByHorse.get(entry.horse_id) ?? []
      list.push({ horseId: entry.horse_id, raceDatetime, finishingPosition: entry.finishing_position, fieldSize, margin: entry.margin, status: entry.status })
      startsByHorse.set(entry.horse_id, list)
    }
  }

  interface Row { raceDatetime: string; priorTrend: number; priorAverage: number; wonOrPlaced: boolean }
  const rows: Row[] = []
  for (const starts of startsByHorse.values()) {
    const finished = starts.filter((start) => start.status !== 'scratched' && start.finishingPosition != null).sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
    for (let index = 0; index < finished.length; index += 1) {
      const priorChronological = finished.slice(0, index)
      if (priorChronological.length < 3) continue
      const priorRecentFirst = [...priorChronological].reverse().map((start) => ({
        resultScore: resultScore({
          raceId: '', horseId: start.horseId, racecourseId: '', raceDatetime: start.raceDatetime,
          finishingPosition: start.finishingPosition ?? undefined, fieldSize: start.fieldSize, margin: start.margin ?? undefined,
        }),
      }))
      const trend = formTrend(priorRecentFirst)
      if (trend === null) continue
      const average = priorRecentFirst.reduce((sum, point) => sum + point.resultScore, 0) / priorRecentFirst.length
      const current = finished[index]
      rows.push({
        raceDatetime: current.raceDatetime,
        priorTrend: trend,
        priorAverage: average,
        wonOrPlaced: (current.finishingPosition ?? 99) <= 3,
      })
    }
  }
  rows.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
  console.log(`Rows with >=3 prior finished starts: ${rows.length}`)

  const validationEnd = Math.floor(rows.length * 0.85)
  const discovery = rows.slice(0, validationEnd)
  const holdout = rows.slice(validationEnd)

  // Control for the average being similar between groups by comparing within similar-average bands,
  // so any difference found is attributable to the TREND rather than just a higher average.
  const sortedTrends = discovery.map((row) => row.priorTrend).sort((a, b) => a - b)
  const median = sortedTrends[Math.floor(sortedTrends.length / 2)]
  console.log(`Discovery median prior trend: ${median.toFixed(4)}`)

  function summarize(label: string, subset: Row[]) {
    if (!subset.length) { console.log(`  ${label}: n=0`); return }
    const rate = subset.filter((row) => row.wonOrPlaced).length / subset.length
    const avgOfAverage = subset.reduce((sum, row) => sum + row.priorAverage, 0) / subset.length
    console.log(`  ${label}: n=${subset.length}, top-3 rate=${(rate * 100).toFixed(1)}%, avg(priorAverage)=${avgOfAverage.toFixed(3)}`)
  }

  console.log('\nHoldout generalization check (top-3 rate by prior trend, holding recent-form average roughly constant):')
  for (const band of [{ label: 'low prior average (<0.4)', filter: (r: Row) => r.priorAverage < 0.4 }, { label: 'mid prior average (0.4-0.6)', filter: (r: Row) => r.priorAverage >= 0.4 && r.priorAverage < 0.6 }, { label: 'high prior average (>=0.6)', filter: (r: Row) => r.priorAverage >= 0.6 }]) {
    console.log(`${band.label}:`)
    const bandRows = holdout.filter(band.filter)
    summarize('  improving (trend > median)', bandRows.filter((row) => row.priorTrend > median))
    summarize('  declining (trend <= median)', bandRows.filter((row) => row.priorTrend <= median))
  }
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
