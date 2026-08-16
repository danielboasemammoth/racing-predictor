import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
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

type HorseRow = {
  id: string
  name: string
}

type PredictionRow = {
  race_id: string
  predictions: any
  confidence_scores: any
  predicted_at: string
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

function normaliseRacecourse(name: string): string | null {
  const value = name.trim()
  // @ts-ignore
  return VICTORIA_RACECOURSES.find((course) => value.toLowerCase().includes(course.toLowerCase())) ?? null
}

async function loadRecentCompletedRaces(hoursBack = 48) {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString()
  const { data: racecourses, error: racecoursesError } = await supabase
    .from('racecourses')
    .select('id, name')
  if (racecoursesError) throw racecoursesError
  const courseNames = new Map((racecourses ?? []).map((rc) => [rc.id, rc.name]))

  const { data: races, error } = await supabase
    .from('races')
    .select('id, racecourse_id, race_datetime, distance_m, track_condition, race_class, status')
    .eq('status', 'completed')
    .gte('race_datetime', cutoff)
    .order('race_datetime', { ascending: false })

  if (error) throw error
  const rows = (races ?? []) as RaceRow[]
  for (const race of rows) {
    race.racecourse_id = courseNames.get(race.racecourse_id) ?? race.racecourse_id
  }
  return rows
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

async function loadHorses(horseIds: string[]) {
  if (!horseIds.length) return [] as HorseRow[]
  const rows: HorseRow[] = []
  const chunkSize = 20

  for (let offset = 0; offset < horseIds.length; offset += chunkSize) {
    const chunk = horseIds.slice(offset, offset + chunkSize)
    const { data, error } = await supabase
      .from('horses')
      .select('id, name')
      .in('id', chunk)

    if (error) throw error
    rows.push(...((data ?? []) as HorseRow[]))
  }

  return rows
}

async function loadPredictionsForRaces(raceIds: string[]) {
  if (!raceIds.length) return [] as PredictionRow[]
  const rows: PredictionRow[] = []
  const chunkSize = 20

  for (let offset = 0; offset < raceIds.length; offset += chunkSize) {
    const chunk = raceIds.slice(offset, offset + chunkSize)
    const { data, error } = await supabase
      .from('predictions')
      .select('race_id, predictions, confidence_scores, predicted_at')
      .in('race_id', chunk)
      .order('predicted_at', { ascending: false })

    if (error) throw error
    rows.push(...((data ?? []) as PredictionRow[]))
  }

  return rows
}

function buildHorseMap(horses: HorseRow[]) {
  return new Map(horses.map((horse) => [horse.id, horse.name]))
}

function buildEntriesByRace(entries: EntryRow[]) {
  const map = new Map<string, EntryRow[]>()
  for (const entry of entries) {
    const existing = map.get(entry.race_id) ?? []
    existing.push(entry)
    map.set(entry.race_id, existing)
  }
  return map
}

function buildPredictionsByRace(predictions: PredictionRow[]) {
  const map = new Map<string, PredictionRow>()
  for (const prediction of predictions) {
    map.set(prediction.race_id, prediction)
  }
  return map
}

function pickPredictedPodium(prediction: PredictionRow): Array<{ horse_id: string; horse_name?: string; win_probability?: number }> {
  const podium = prediction.predictions?.podium ?? prediction.predictions?.all_horses?.slice(0, 3) ?? []
  return podium.map((horse: any) => ({
    horse_id: horse.horse_id,
    horse_name: horse.horse_name,
    win_probability: horse.win_probability,
  }))
}

function pickActualPodium(entries: EntryRow[], horseMap: Map<string, string>) {
  const finished = entries
    .filter((entry) => entry.status !== 'scratched' && entry.finishing_position != null)
    .sort((left, right) => left.finishing_position! - right.finishing_position!)
  return finished.slice(0, 3).map((entry) => ({
    horse_id: entry.horse_id,
    horse_name: horseMap.get(entry.horse_id) ?? 'Unknown',
    finishing_position: entry.finishing_position,
    finishing_time: entry.finishing_time,
  }))
}

function scorePrediction(predictedPodium: Array<{ horse_id: string }>, actualPodium: Array<{ horse_id: string }>) {
  const predictedIds = predictedPodium.map((entry) => entry.horse_id)
  const actualIds = actualPodium.map((entry) => entry.horse_id)

  const winnerCorrect = predictedIds[0] === actualIds[0]
  const exacta = predictedIds[1] === actualIds[1]
  const trifecta = predictedIds[2] === actualIds[2]
  const anyCorrect = predictedIds.some((id) => actualIds.includes(id))

  return {
    winnerCorrect,
    exacta,
    trifecta,
    anyCorrect,
    score: (winnerCorrect ? 3 : 0) + (exacta ? 2 : 0) + (trifecta ? 1 : 0) + (anyCorrect && !winnerCorrect ? 1 : 0),
  }
}

async function evaluateLast48Hours() {
  const races = await loadRecentCompletedRaces(48)
  console.log(`Last-48h completed races: ${races.length}`)

  if (!races.length) {
    console.log('No completed races in the last 48 hours')
    return
  }

  const victoriaRaces = races.filter((race) => normaliseRacecourse(race.racecourse_id) != null)
  console.log(`Victoria races: ${victoriaRaces.length}`)

  const raceIds = races.map((race) => race.id)
  const [entries, horses, predictions] = await Promise.all([
    loadEntriesForRaces(raceIds),
    loadHorses([...new Set(races.flatMap((race) => []))]),
    loadPredictionsForRaces(raceIds),
  ])

  const horseIds = [...new Set(entries.map((entry) => entry.horse_id))]
  const horseRows = await loadHorses(horseIds)
  const horseMap = buildHorseMap(horseRows)
  const entriesByRace = buildEntriesByRace(entries)
  const predictionsByRace = buildPredictionsByRace(predictions)

  console.log('\n=== Last 48 Hours Results ===\n')

  let totalScore = 0
  let maxScore = 0
  let predictedRaces = 0

  for (const race of races) {
    const raceEntries = entriesByRace.get(race.id) ?? []
    if (!raceEntries.length) continue

    const prediction = predictionsByRace.get(race.id)
    if (!prediction) continue

    predictedRaces += 1
    const predictedPodium = pickPredictedPodium(prediction)
    const actualPodium = pickActualPodium(raceEntries, horseMap)
    const result = scorePrediction(predictedPodium, actualPodium)
    totalScore += result.score
    maxScore += 6

    const course = normaliseRacecourse(race.racecourse_id) ?? race.racecourse_id
    console.log(`# ${course} - ${new Date(race.race_datetime).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}`)
    console.log(`  Predicted:`)
    predictedPodium.forEach((entry, index) => {
      const name = entry.horse_name ?? horseMap.get(entry.horse_id) ?? 'Unknown'
      console.log(`    ${index + 1}. ${name} ${entry.win_probability ? `(${(entry.win_probability * 100).toFixed(1)}%)` : ''}`)
    })
    console.log(`  Actual:`)
    actualPodium.forEach((entry, index) => {
      console.log(`    ${index + 1}. ${entry.horse_name}${entry.finishing_time ? ` (${entry.finishing_time}s)` : ''}`)
    })
    console.log(`  Result: ${result.winnerCorrect ? '✓' : '✗'} winner | ${result.exacta ? '✓' : '✗'} exacta | ${result.trifecta ? '✓' : '✗'} trifecta`)
    console.log()
  }

  if (!predictedRaces) {
    console.log('No predictions available for recent races')
    return
  }

  const percentage = ((totalScore / maxScore) * 100).toFixed(1)
  console.log(`Overall score: ${totalScore}/${maxScore} (${percentage}%)`)
}

evaluateLast48Hours().catch((error) => {
  console.error('Evaluation failed', error)
  process.exit(1)
})
