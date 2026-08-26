/**
 * One-off experiment: race-strength / key-race hypothesis (spec Phase 8). If OTHER runners from
 * a race subsequently go on to win, does a horse's own good run in that race predict its NEXT
 * start better than an equally good run in a race whose other runners never won again? Time-safe
 * (the "did another runner subsequently win" check is restricted to before the target horse's own
 * next start, so a real bettor could have known it) and excludes the target horse itself from
 * the "other runners" set (avoids the obvious circularity of a horse's own future validating its
 * own past race). Chronological 85/15 split. Read-only.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface Start {
  raceId: string
  horseId: string
  raceDatetime: string
  finishingPosition: number | null
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

  const allStarts: Start[] = []
  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const { data, error } = await supabase.from('race_entries').select('race_id, horse_id, finishing_position, status').in('race_id', chunk)
    if (error) throw error
    for (const entry of (data ?? []) as Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string }>) {
      const raceDatetime = raceDatetimeById.get(entry.race_id)
      if (!raceDatetime) continue
      allStarts.push({ raceId: entry.race_id, horseId: entry.horse_id, raceDatetime, finishingPosition: entry.finishing_position, status: entry.status })
    }
  }
  console.log(`Total starts: ${allStarts.length}`)

  const entriesByRace = new Map<string, Start[]>()
  const startsByHorse = new Map<string, Start[]>()
  for (const start of allStarts) {
    if (start.status === 'scratched') continue
    const raceList = entriesByRace.get(start.raceId) ?? []
    raceList.push(start)
    entriesByRace.set(start.raceId, raceList)
    const horseList = startsByHorse.get(start.horseId) ?? []
    horseList.push(start)
    startsByHorse.set(start.horseId, horseList)
  }
  for (const list of startsByHorse.values()) list.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))

  interface Row { raceDatetime: string; raceWasStrong: boolean; nextStartTop3: boolean }
  const rows: Row[] = []
  for (const [horseId, starts] of startsByHorse) {
    for (let index = 0; index < starts.length - 1; index += 1) {
      const current = starts[index]
      const next = starts[index + 1]
      if ((current.finishingPosition ?? 99) > 3) continue // only test after a top-3 run
      const otherRunners = (entriesByRace.get(current.raceId) ?? []).filter((entry) => entry.horseId !== horseId)
      if (otherRunners.length < 3) continue
      const raceWasStrong = otherRunners.some((runner) => {
        const runnerStarts = startsByHorse.get(runner.horseId) ?? []
        return runnerStarts.some((s) => s.raceDatetime > current.raceDatetime && s.raceDatetime < next.raceDatetime && s.finishingPosition === 1)
      })
      rows.push({ raceDatetime: next.raceDatetime, raceWasStrong, nextStartTop3: (next.finishingPosition ?? 99) <= 3 })
    }
  }
  rows.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))
  console.log(`Rows (a top-3 run followed by a next start): ${rows.length}`)

  const validationEnd = Math.floor(rows.length * 0.85)
  const discovery = rows.slice(0, validationEnd)
  const holdout = rows.slice(validationEnd)

  function summarize(label: string, subset: Row[]) {
    if (!subset.length) { console.log(`  ${label}: n=0`); return }
    const rate = subset.filter((row) => row.nextStartTop3).length / subset.length
    console.log(`  ${label}: n=${subset.length}, next-start top-3 rate=${(rate * 100).toFixed(1)}%`)
  }

  console.log(`\nDiscovery (n=${discovery.length}):`)
  summarize('Came from a subsequently-strong race', discovery.filter((row) => row.raceWasStrong))
  summarize('Came from a race with no proven subsequent strength', discovery.filter((row) => !row.raceWasStrong))

  console.log(`\nHoldout (n=${holdout.length}):`)
  summarize('Came from a subsequently-strong race', holdout.filter((row) => row.raceWasStrong))
  summarize('Came from a race with no proven subsequent strength', holdout.filter((row) => !row.raceWasStrong))
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
