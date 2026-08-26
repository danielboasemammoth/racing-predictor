/**
 * One-off experiment: does a horse's PRIOR sectional/benchmarked-speed rating (recency-weighted
 * average of standard_time_difference from strictly earlier starts) predict its NEXT result
 * beyond a plain finishing-position-based recentForm average? Chronological 85/15 split, tested
 * against the untouched holdout. Read-only. Requires the sectional-pace-data migration + backfill
 * (scripts/backfill-sectional-data.ts) to have run first.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { averageSectionalRating } from '../src/lib/sectional-speed'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface StartRow {
  horseId: string
  raceDatetime: string
  finishingPosition: number | null
  fieldSize: number
  margin: number | null
  standardTimeDifference: number | null
  status: string
}

function parseStandardTimeDifference(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /(-?\d+(?:\.\d+)?)/.exec(value)
  return match ? Number.parseFloat(match[1]) : null
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

  const entriesByRace = new Map<string, Array<{ horse_id: string; finishing_position: number | null; status: string; margin: number | null; speed_ratings: unknown }>>()
  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const { data, error } = await supabase.from('race_entries').select('race_id, horse_id, finishing_position, status, margin, speed_ratings').in('race_id', chunk)
    if (error) throw error
    for (const entry of (data ?? []) as Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string; margin: number | null; speed_ratings: unknown }>) {
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
      const stdDiff = entry.speed_ratings && typeof entry.speed_ratings === 'object'
        ? parseStandardTimeDifference((entry.speed_ratings as { standard_time_difference?: unknown }).standard_time_difference)
        : null
      const list = startsByHorse.get(entry.horse_id) ?? []
      list.push({ horseId: entry.horse_id, raceDatetime, finishingPosition: entry.finishing_position, fieldSize, margin: entry.margin, standardTimeDifference: stdDiff, status: entry.status })
      startsByHorse.set(entry.horse_id, list)
    }
  }

  interface Row { raceDatetime: string; priorSectionalRating: number; wonOrPlaced: boolean; won: boolean }
  const rows: Row[] = []
  for (const starts of startsByHorse.values()) {
    const finished = starts.filter((start) => start.status !== 'scratched' && start.finishingPosition != null).sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
    for (let index = 0; index < finished.length; index += 1) {
      const priorChronological = finished.slice(0, index)
      const priorRecentFirst = [...priorChronological].reverse().map((start) => ({ standardTimeDifference: start.standardTimeDifference }))
      const rating = averageSectionalRating(priorRecentFirst)
      if (rating === null) continue
      const current = finished[index]
      rows.push({
        raceDatetime: current.raceDatetime,
        priorSectionalRating: rating,
        wonOrPlaced: (current.finishingPosition ?? 99) <= 3,
        won: current.finishingPosition === 1,
      })
    }
  }
  rows.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
  console.log(`Rows with >=1 prior sectional-rated start: ${rows.length}`)

  if (rows.length < 40) {
    console.log('Too few rows to run a meaningful discovery/holdout split yet - backfill more history and re-run.')
    return
  }

  const validationEnd = Math.floor(rows.length * 0.85)
  const discovery = rows.slice(0, validationEnd)
  const holdout = rows.slice(validationEnd)
  const sortedRatings = discovery.map((row) => row.priorSectionalRating).sort((a, b) => a - b)
  const median = sortedRatings[Math.floor(sortedRatings.length / 2)]
  console.log(`Discovery: ${discovery.length}, holdout: ${holdout.length}, median prior sectional rating: ${median.toFixed(2)}`)

  function summarize(label: string, subset: Row[]) {
    if (!subset.length) { console.log(`  ${label}: n=0`); return }
    const top3Rate = subset.filter((row) => row.wonOrPlaced).length / subset.length
    const winRate = subset.filter((row) => row.won).length / subset.length
    console.log(`  ${label}: n=${subset.length}, win rate=${(winRate * 100).toFixed(1)}%, top-3 rate=${(top3Rate * 100).toFixed(1)}%`)
  }

  console.log('\nHoldout generalization check:')
  summarize('Above-median prior sectional rating (historically fast/well-benchmarked)', holdout.filter((row) => row.priorSectionalRating > median))
  summarize('Below-median prior sectional rating', holdout.filter((row) => row.priorSectionalRating <= median))
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
