import 'dotenv/config'
import { config } from 'dotenv'
import { createScriptClient } from './supabase-client'
config({ path: '.env.local' })

const supabase = createScriptClient()

const VICTORIA_RACECOURSES = [
  'Flemington',
  'Caulfield',
  'Moonee Valley',
  'Sandown',
  'Ballarat',
  'Bendigo',
  'Geelong',
  'Mornington',
  'Sale',
  'Cranbourne',
  'Pakenham',
  'Melton',
  'Healesville',
  'Traralgon',
  'Moe',
  'Wodonga',
  'Shepparton',
  'Mildura',
  'Wangaratta',
  'Ararat',
  'Echuca',
  'Swan Hill',
  'Horsham',
  'Casterton',
  'Portland',
]

type RaceRow = {
  id: string
  racecourse_id: string
  race_datetime: string
  distance_m: number | null
  track_condition: string | null
  race_class: string | null
  status: string
}

type EntryRow = {
  race_id: string
  horse_id: string
  finishing_position: number | null
  finishing_time: number | null
  margin: number | null
  barrier_number: number | null
  weight_carried: number | null
  jockey: string | null
  trainer: string | null
  status: string
}

function normaliseRacecourse(name: string): string | null {
  const value = name.trim()
  return VICTORIA_RACECOURSES.find((course) => value.toLowerCase().includes(course.toLowerCase())) ?? null
}

async function loadVictoriaRacecourses() {
  const { data, error } = await supabase
    .from('racecourses')
    .select('id, name')

  if (error) throw error

  return (data ?? [])
    .map((racecourse) => ({ id: racecourse.id, normalised: normaliseRacecourse(racecourse.name) }))
    .filter((rc) => rc.normalised != null)
}

async function loadRecentCompletedRaces(racecourseIds: string[], hoursBack = 168) {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('races')
    .select('id, racecourse_id, race_datetime, distance_m, track_condition, race_class, status')
    .eq('status', 'completed')
    .in('racecourse_id', racecourseIds)
    .gte('race_datetime', cutoff)
    .order('race_datetime', { ascending: false })

  if (error) throw error
  return (data ?? []) as RaceRow[]
}

async function loadEntriesForRaces(raceIds: string[]) {
  if (!raceIds.length) return [] as EntryRow[]
  const rows: EntryRow[] = []
  const chunkSize = 20

  for (let offset = 0; offset < raceIds.length; offset += chunkSize) {
    const chunk = raceIds.slice(offset, offset + chunkSize)
    const { data, error } = await supabase
      .from('race_entries')
      .select('race_id, horse_id, finishing_position, finishing_time, margin, barrier_number, weight_carried, jockey, trainer, status')
      .in('race_id', chunk)

    if (error) throw error
    rows.push(...((data ?? []) as EntryRow[]))
  }

  return rows
}

async function inspectVictoriaData() {
  console.log('Loading Victoria racecourses...')
  const victoriaCourses = await loadVictoriaRacecourses()
  console.log(`Found ${victoriaCourses.length} Victoria racecourses`)

  const courseIds = victoriaCourses.map((rc) => rc.id)
  console.log('Recent completed Victoria races (last 7 days):')
  const races = await loadRecentCompletedRaces(courseIds, 168)
  console.log(`  ${races.length} races`)

  const raceIds = races.map((race) => race.id)
  const entries = await loadEntriesForRaces(raceIds)
  console.log(`  ${entries.length} entries`)

  const withResults = entries.filter((entry) => entry.finishing_position != null)
  console.log(`  ${withResults.length} entries with finishing positions`)

  const byRace = new Map<string, number>()
  for (const entry of entries) {
    byRace.set(entry.race_id, (byRace.get(entry.race_id) ?? 0) + 1)
  }

  console.log('\nSample races:')
  for (const race of races.slice(0, 5)) {
    const course = victoriaCourses.find((rc) => rc.id === race.racecourse_id)
    console.log(`  ${course?.normalised ?? race.racecourse_id} - ${race.race_datetime} - ${byRace.get(race.id) ?? 0} entries`)
  }

  console.log('\nData quality summary:')
  console.log(`  Total Victoria races: ${races.length}`)
  console.log(`  Races with entries: ${[...byRace.keys()].length}`)
  console.log(`  Entries with results: ${withResults.length}`)
  console.log(`  Average field size: ${entries.length ? (entries.length / [...byRace.keys()].length).toFixed(1) : 'N/A'}`)
}

inspectVictoriaData().catch((error) => {
  console.error('Inspection failed', error)
  process.exit(1)
})
