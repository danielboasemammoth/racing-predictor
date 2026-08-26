/**
 * One-off experiment: build the barrier-bias table from the first 85% of races chronologically,
 * then check whether it actually generalizes - do horses in buckets the table says are
 * favourable (positive lift) actually win more often than horses in unfavourable (negative lift)
 * buckets on the untouched last 15%? This is a prerequisite check before ever wiring
 * barrier-bias into prediction-v3.ts. Read-only.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { buildBarrierBiasTable, barrierBiasLift, type BarrierBiasRow } from '../src/lib/barrier-bias'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface RaceRow {
  id: string
  racecourse_id: string
  distance_m: number | null
  race_datetime: string
}

interface EntryRow {
  race_id: string
  barrier_number: number | null
  finishing_position: number | null
  status: string
}

async function main() {
  const races: RaceRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('races')
      .select('id, racecourse_id, distance_m, race_datetime')
      .eq('status', 'completed')
      .range(offset, offset + 999)
    if (error) throw error
    races.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const raceById = new Map(races.map((race) => [race.id, race]))
  const raceIds = races.map((race) => race.id)
  console.log(`Loaded ${raceIds.length} completed races`)

  const entriesByRace = new Map<string, EntryRow[]>()
  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const { data, error } = await supabase
      .from('race_entries')
      .select('race_id, barrier_number, finishing_position, status')
      .in('race_id', chunk)
    if (error) throw error
    for (const entry of (data ?? []) as EntryRow[]) {
      const list = entriesByRace.get(entry.race_id) ?? []
      list.push(entry)
      entriesByRace.set(entry.race_id, list)
    }
  }

  const rows: (BarrierBiasRow & { raceDatetime: string })[] = []
  for (const [raceId, entries] of entriesByRace) {
    const race = raceById.get(raceId)
    if (!race) continue
    const runners = entries.filter((entry) => entry.status !== 'scratched')
    const fieldSize = runners.length
    if (fieldSize < 4) continue
    for (const entry of runners) {
      if (entry.barrier_number == null) continue
      rows.push({
        racecourseId: race.racecourse_id,
        distanceM: race.distance_m,
        fieldSize,
        barrier: entry.barrier_number,
        won: entry.finishing_position === 1,
        raceDatetime: race.race_datetime,
      })
    }
  }
  rows.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
  console.log(`Runner-level rows: ${rows.length}`)

  const validationEnd = Math.floor(rows.length * 0.85)
  const discovery = rows.slice(0, validationEnd)
  const holdout = rows.slice(validationEnd)
  console.log(`Discovery: ${discovery.length}, holdout: ${holdout.length}`)

  const table = buildBarrierBiasTable(discovery)
  console.log(`\nGlobal buckets (top 10 by sample size):`)
  for (const bucket of table.global.slice(0, 10)) {
    console.log(`  ${bucket.label}: n=${bucket.n}, strike rate=${(bucket.strikeRate * 100).toFixed(1)}%, lift=${(bucket.lift * 100).toFixed(1)}pts, significant=${bucket.significant}`)
  }

  let positiveWins = 0
  let positiveTotal = 0
  let negativeWins = 0
  let negativeTotal = 0
  let neutralWins = 0
  let neutralTotal = 0

  for (const row of holdout) {
    const lift = barrierBiasLift(table, row.racecourseId, row.distanceM, row.fieldSize, row.barrier)
    if (lift > 0.01) {
      positiveTotal += 1
      if (row.won) positiveWins += 1
    } else if (lift < -0.01) {
      negativeTotal += 1
      if (row.won) negativeWins += 1
    } else {
      neutralTotal += 1
      if (row.won) neutralWins += 1
    }
  }

  console.log(`\nHoldout generalization check:`)
  console.log(`  Positive-lift buckets: n=${positiveTotal}, actual win rate=${positiveTotal ? (positiveWins / positiveTotal * 100).toFixed(1) : 'n/a'}%`)
  console.log(`  Neutral buckets:       n=${neutralTotal}, actual win rate=${neutralTotal ? (neutralWins / neutralTotal * 100).toFixed(1) : 'n/a'}%`)
  console.log(`  Negative-lift buckets: n=${negativeTotal}, actual win rate=${negativeTotal ? (negativeWins / negativeTotal * 100).toFixed(1) : 'n/a'}%`)
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
