/**
 * One-off experiment: does a HABITUAL LEADER (per prior settled-position history, computed
 * time-safe) win more often when it's racing in an "uncontested" pace shape (no other
 * leader/on-pace types in that specific field) than when the pace is "hot" (multiple genuine
 * leaders competing for the front)? This is a well-known racing hypothesis (an uncontested
 * leader gets an easy, energy-saving run) and a natural first test of the race-shape module.
 * Chronological 85/15 split. Read-only.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { habitualRunningStyle, summarizePaceShape, type RunningPositionStart } from '../src/lib/race-shape'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface Entry {
  raceId: string
  horseId: string
  raceDatetime: string
  finishingPosition: number | null
  status: string
  positionAtSettled: number | null
  fieldSize: number
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

  const entriesByRace = new Map<string, Array<{ horse_id: string; finishing_position: number | null; status: string; running_positions: unknown }>>()
  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const { data, error } = await supabase.from('race_entries').select('race_id, horse_id, finishing_position, status, running_positions').in('race_id', chunk)
    if (error) throw error
    for (const entry of (data ?? []) as Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string; running_positions: unknown }>) {
      const list = entriesByRace.get(entry.race_id) ?? []
      list.push(entry)
      entriesByRace.set(entry.race_id, list)
    }
  }

  const allEntries: Entry[] = []
  for (const [raceId, entries] of entriesByRace) {
    const raceDatetime = raceDatetimeById.get(raceId)
    if (!raceDatetime) continue
    const fieldSize = entries.filter((entry) => entry.status !== 'scratched').length
    for (const entry of entries) {
      const positionAtSettled = entry.running_positions && typeof entry.running_positions === 'object'
        ? (entry.running_positions as { at_settled?: number | null }).at_settled ?? null
        : null
      allEntries.push({ raceId, horseId: entry.horse_id, raceDatetime, finishingPosition: entry.finishing_position, status: entry.status, positionAtSettled, fieldSize })
    }
  }
  // Index each horse's OWN dated settled-position starts for time-safe lookups.
  const datedStartsByHorse = new Map<string, Array<{ raceDatetime: string; start: RunningPositionStart }>>()
  for (const entry of allEntries) {
    if (entry.status === 'scratched') continue
    const list = datedStartsByHorse.get(entry.horseId) ?? []
    list.push({ raceDatetime: entry.raceDatetime, start: { positionAtSettled: entry.positionAtSettled, fieldSize: entry.fieldSize } })
    datedStartsByHorse.set(entry.horseId, list)
  }
  for (const list of datedStartsByHorse.values()) list.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))

  interface Row { raceDatetime: string; pacePressure: 'uncontested' | 'moderate' | 'hot'; won: boolean }
  const rows: Row[] = []
  for (const [raceId, entries] of entriesByRace) {
    const raceDatetime = raceDatetimeById.get(raceId)
    if (!raceDatetime) continue
    const runners = entries.filter((entry) => entry.status !== 'scratched')
    if (runners.length < 5) continue

    const styles = runners.map((entry) => {
      const priorStarts = (datedStartsByHorse.get(entry.horse_id) ?? [])
        .filter((dated) => dated.raceDatetime < raceDatetime)
        .map((dated) => dated.start)
      return { horseId: entry.horse_id, style: habitualRunningStyle(priorStarts), finishingPosition: entry.finishing_position }
    })
    const paceShape = summarizePaceShape(styles.map((entry) => entry.style))
    const leaders = styles.filter((entry) => entry.style === 'leader')
    for (const leader of leaders) {
      rows.push({ raceDatetime, pacePressure: paceShape.pacePressure, won: leader.finishingPosition === 1 })
    }
  }
  rows.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
  console.log(`Habitual-leader rows (their own field's pace shape known): ${rows.length}`)

  const validationEnd = Math.floor(rows.length * 0.85)
  const discovery = rows.slice(0, validationEnd)
  const holdout = rows.slice(validationEnd)

  function summarize(label: string, subset: Row[]) {
    if (!subset.length) { console.log(`  ${label}: n=0`); return }
    const winRate = subset.filter((row) => row.won).length / subset.length
    console.log(`  ${label}: n=${subset.length}, win rate=${(winRate * 100).toFixed(1)}%`)
  }

  console.log(`\nDiscovery (n=${discovery.length}):`)
  summarize('Uncontested leaders', discovery.filter((row) => row.pacePressure === 'uncontested'))
  summarize('Moderate-pressure leaders', discovery.filter((row) => row.pacePressure === 'moderate'))
  summarize('Hot-pressure leaders', discovery.filter((row) => row.pacePressure === 'hot'))

  console.log(`\nHoldout (n=${holdout.length}):`)
  summarize('Uncontested leaders', holdout.filter((row) => row.pacePressure === 'uncontested'))
  summarize('Moderate-pressure leaders', holdout.filter((row) => row.pacePressure === 'moderate'))
  summarize('Hot-pressure leaders', holdout.filter((row) => row.pacePressure === 'hot'))
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
