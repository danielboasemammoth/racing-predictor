/**
 * One-off experiment: the classic "forgive a troubled run" racing theory - does a horse that had
 * a troubled run (slow start / held up / checked / raced wide, per src/lib/stewards-nlp.ts) in
 * its LAST start perform BETTER in its NEXT start than its own last finishing position alone
 * would suggest? Compares within similar-finishing-position bands so any difference found is
 * attributable to the trouble flag, not just a stronger horse. Chronological 85/15 split.
 * Read-only.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { extractStewardsFlags, hadTroubledRun } from '../src/lib/stewards-nlp'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface Start {
  horseId: string
  raceDatetime: string
  finishingPosition: number | null
  fieldSize: number
  status: string
  stewardsComment: string | null
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

  const entriesByRace = new Map<string, Array<{ horse_id: string; finishing_position: number | null; status: string; stewards_comment: string | null }>>()
  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const { data, error } = await supabase.from('race_entries').select('race_id, horse_id, finishing_position, status, stewards_comment').in('race_id', chunk)
    if (error) throw error
    for (const entry of (data ?? []) as Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string; stewards_comment: string | null }>) {
      const list = entriesByRace.get(entry.race_id) ?? []
      list.push(entry)
      entriesByRace.set(entry.race_id, list)
    }
  }

  const startsByHorse = new Map<string, Start[]>()
  for (const [raceId, entries] of entriesByRace) {
    const raceDatetime = raceDatetimeById.get(raceId)
    if (!raceDatetime) continue
    const fieldSize = entries.filter((entry) => entry.status !== 'scratched').length
    for (const entry of entries) {
      const list = startsByHorse.get(entry.horse_id) ?? []
      list.push({ horseId: entry.horse_id, raceDatetime, finishingPosition: entry.finishing_position, fieldSize, status: entry.status, stewardsComment: entry.stewards_comment })
      startsByHorse.set(entry.horse_id, list)
    }
  }
  for (const list of startsByHorse.values()) list.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))

  interface Row { raceDatetime: string; lastPositionBand: string; troubled: boolean; nextTop3: boolean }
  const rows: Row[] = []
  function positionBand(position: number, fieldSize: number) {
    const percentile = fieldSize > 1 ? (position - 1) / (fieldSize - 1) : 0
    if (percentile <= 0.33) return 'front-third'
    if (percentile <= 0.66) return 'mid-third'
    return 'back-third'
  }

  for (const starts of startsByHorse.values()) {
    const finished = starts.filter((start) => start.status !== 'scratched' && start.finishingPosition != null)
    for (let index = 0; index < finished.length - 1; index += 1) {
      const current = finished[index]
      const next = finished[index + 1]
      const troubled = hadTroubledRun(extractStewardsFlags(current.stewardsComment))
      rows.push({
        raceDatetime: next.raceDatetime,
        lastPositionBand: positionBand(current.finishingPosition!, current.fieldSize),
        troubled,
        nextTop3: (next.finishingPosition ?? 99) <= 3,
      })
    }
  }
  rows.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
  console.log(`Rows (a finished start followed by a next start): ${rows.length}`)
  console.log(`Of which troubled: ${rows.filter((row) => row.troubled).length}`)

  const validationEnd = Math.floor(rows.length * 0.85)
  const discovery = rows.slice(0, validationEnd)
  const holdout = rows.slice(validationEnd)

  function summarize(label: string, subset: Row[]) {
    if (!subset.length) { console.log(`  ${label}: n=0`); return }
    const rate = subset.filter((row) => row.nextTop3).length / subset.length
    console.log(`  ${label}: n=${subset.length}, next-start top-3 rate=${(rate * 100).toFixed(1)}%`)
  }

  for (const [label, set] of [['Discovery', discovery], ['Holdout', holdout]] as const) {
    console.log(`\n${label}:`)
    for (const band of ['front-third', 'mid-third', 'back-third']) {
      console.log(` ${band}:`)
      summarize('  troubled last run', set.filter((row) => row.lastPositionBand === band && row.troubled))
      summarize('  clean last run', set.filter((row) => row.lastPositionBand === band && !row.troubled))
    }
  }
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
