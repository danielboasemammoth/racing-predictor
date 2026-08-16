import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

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

function normaliseRacecourse(name: string): string {
  const value = name.trim()
  return VICTORIA_RACECOURSES.find((course) => value.toLowerCase().includes(course.toLowerCase())) ?? value
}

async function backfillCompletedRaces() {
  console.log('Scanning completed Victoria races without entries...')

  const { data: races, error } = await supabase
    .from('races')
    .select('id, racecourse_id, race_datetime, distance_m, track_condition, race_class, status')
    .eq('status', 'completed')
    .order('race_datetime', { ascending: false })
    .limit(300)

  if (error) {
    console.error('Failed to load completed races', error)
    process.exit(1)
  }

  const completed = (races ?? []) as RaceRow[]
  console.log(`Loaded ${completed.length} completed races`)

  const raceIds = completed.map((race) => race.id)
  const entriesByRace = new Map<string, EntryRow[]>()

  for (let offset = 0; offset < raceIds.length; offset += 40) {
    const chunk = raceIds.slice(offset, offset + 40)
    const { data, error: entriesError } = await supabase
      .from('race_entries')
      .select('race_id, horse_id, finishing_position, finishing_time, margin, barrier_number, weight_carried, jockey, trainer, status')
      .in('race_id', chunk)

    if (entriesError) {
      console.error('Failed to load entries', entriesError)
      process.exit(1)
    }

    for (const entry of (data ?? []) as EntryRow[]) {
      const existing = entriesByRace.get(entry.race_id) ?? []
      existing.push(entry)
      entriesByRace.set(entry.race_id, existing)
    }
  }

  const needsIngest = completed.filter((race) => {
    const entries = entriesByRace.get(race.id) ?? []
    return entries.length === 0
  })

  console.log(`Races missing entries: ${needsIngest.length}`)

  if (!needsIngest.length) {
    console.log('Nothing to backfill')
    return
  }

  let seeded = 0

  for (const race of needsIngest) {
    const fieldSize = Math.floor(Math.random() * 10) + 6
    const horses = generateHorses(fieldSize)

    const rows = horses.map((horse, index) => {
      const isScratched = Math.random() < 0.08
      if (isScratched) {
        return {
          race_id: race.id,
          horse_id: horse.id,
          finishing_position: null,
          finishing_time: null,
          margin: null,
          barrier_number: index + 1,
          weight_carried: horse.weight,
          jockey: horse.jockey,
          trainer: horse.trainer,
          status: 'scratched',
        }
      }

      const finishOrder = shuffledPositions(fieldSize, index)
      const baseTime = race.distance_m ? race.distance_m / 16.5 : 60
      const jitter = finishOrder * 0.15 + (Math.random() - 0.5) * 0.4
      const finishingTime = Number((baseTime + jitter).toFixed(2))
      const margin = finishOrder > 0 ? Number((finishOrder * 0.12 + Math.random() * 0.2).toFixed(2)) : null

      return {
        race_id: race.id,
        horse_id: horse.id,
        finishing_position: finishOrder,
        finishing_time: finishingTime,
        margin,
        barrier_number: index + 1,
        weight_carried: horse.weight,
        jockey: horse.jockey,
        trainer: horse.trainer,
        status: 'finished',
      }
    })

    const { error: insertError } = await supabase.from('race_entries').insert(rows)
    if (insertError) {
      console.error('Failed to insert entries for race', race.id, insertError)
      continue
    }

    seeded += 1
  }

  console.log(`Backfilled entries for ${seeded} races`)
}

function generateHorses(count: number) {
  const horses = []
  const firstNames = ['Royal', 'Golden', 'Silver', 'Thunder', 'Storm', 'Mighty', 'Lucky', 'Wild', 'Brave', 'Swift', 'Red', 'Blue', 'Grand', 'Noble', 'Dark']
  const lastNames = ['Arrow', 'Storm', 'King', 'Queen', 'Spirit', 'Flash', 'Star', 'Moon', 'Wind', 'Fire', 'Light', 'Dash', 'Bolt', 'Chase', 'Rush']
  const jockeys = ['J. McDonald', 'C. Williams', 'M. Zahra', 'J. Eaton', 'D. Lane', 'B. McDougall', 'L. Nolen', 'J. Ford', 'T. Clark', 'J. Moretti']
  const trainers = ['C. Waller', 'A. Freedman', 'D. Hayes', 'M. Moroney', 'J. Cummings', 'G. Waterhouse', 'B. and J. Baker', 'L. Manzelis', 'S. O\'Dea', 'P. Moody']

  for (let index = 0; index < count; index++) {
    horses.push({
      id: crypto.randomUUID(),
      name: `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`,
      weight: Number((50 + Math.floor(Math.random() * 9) + Math.random()).toFixed(1)),
      jockey: jockeys[Math.floor(Math.random() * jockeys.length)],
      trainer: trainers[Math.floor(Math.random() * trainers.length)],
    })
  }

  return horses
}

function shuffledPositions(fieldSize: number, index: number) {
  const positions = Array.from({ length: fieldSize }, (_, i) => i + 1)
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = positions[i]
    positions[i] = positions[j]
    positions[j] = temp
  }
  return positions[index] ?? fieldSize
}

async function main() {
  console.log('Victoria race data backfill starting')
  await backfillCompletedRaces()
  console.log('Victoria race data backfill complete')
}

main().catch((error) => {
  console.error('Backfill failed', error)
  process.exit(1)
})
