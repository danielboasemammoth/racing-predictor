import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type PredictionPayload = {
  podium?: Array<{ horse_id: string; horse_name?: string; win_probability?: number }>
  all_horses?: Array<{ horse_id: string; horse_name?: string; win_probability?: number }>
  [key: string]: unknown
}

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
  horses?: { name: string }
}

type PredictionRow = {
  race_id: string
  predictions: PredictionPayload
  confidence_scores: { winner?: number; overall?: number }
  predicted_at: string
  model_version: string
}

const VICTORIA_RACECOURSES = [
  'Flemington', 'Caulfield', 'Moonee Valley', 'Sandown', 'Ballarat',
  'Bendigo', 'Geelong', 'Mornington', 'Sale', 'Cranbourne', 'Pakenham',
  'Melton', 'Healesville', 'Traralgon', 'Moe', 'Wodonga', 'Shepparton',
  'Mildura', 'Wangaratta', 'Ararat', 'Echuca', 'Swan Hill', 'Horsham',
  'Casterton', 'Portland',
]

function normaliseRacecourse(name: string): string | null {
  const value = name.trim()
  return VICTORIA_RACECOURSES.find((course) => value.toLowerCase().includes(course.toLowerCase())) ?? null
}

async function loadHistoricalRaces(limit: number) {
  const { data: racecourses, error: racecoursesError } = await supabase
    .from('racecourses')
    .select('id, name')
  if (racecoursesError) throw racecoursesError
  const courseNames = new Map((racecourses ?? []).map((rc: { id: string; name: string }) => [rc.id, rc.name]))

  const { data: races, error } = await supabase
    .from('races')
    .select('id, racecourse_id, race_datetime, distance_m, track_condition, race_class, status')
    .eq('status', 'completed')
    .order('race_datetime', { ascending: false })
    .limit(limit)

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
      .select('race_id, horse_id, finishing_position, finishing_time, margin, barrier_number, weight_carried, jockey, trainer, status, horses!inner(name)')
      .in('race_id', chunk)
    if (error) throw error
    rows.push(...((data ?? []) as unknown as EntryRow[]))
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
      .select('race_id, predictions, confidence_scores, predicted_at, model_version')
      .in('race_id', chunk)
      .order('predicted_at', { ascending: false })
    if (error) throw error
    rows.push(...((data ?? []) as PredictionRow[]))
  }
  return rows
}

type MatchResult = {
  raceId: string
  course: string
  distance: number | null
  trackCondition: string | null
  fieldSize: number | null
  isVictoria: boolean
  predictedWinnerBarrier: number | null
  predictedWinnerConfidence: number | null
  actualWinnerBarrier: number | null
  winnerCorrect: boolean
  anyCorrect: boolean
  score: number
  modelVersion: string
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = String((item[key] as string | null) ?? 'null')
    ;(acc[k] ??= []).push(item)
    return acc
  }, {})
}

async function analyzePatterns() {
  const races = await loadHistoricalRaces(500)
  console.log(`Loading data for ${races.length} completed races...`)

  const raceIds = races.map((race) => race.id)
  const [entries, predictions] = await Promise.all([
    loadEntriesForRaces(raceIds),
    loadPredictionsForRaces(raceIds),
  ])

  console.log(`Entries: ${entries.length}, Predictions: ${predictions.length}`)

  const entriesByRace = new Map<string, EntryRow[]>()
  for (const entry of entries) {
    const existing = entriesByRace.get(entry.race_id) ?? []
    existing.push(entry)
    entriesByRace.set(entry.race_id, existing)
  }

  const predictionsByRace = new Map<string, PredictionRow[]>()
  for (const prediction of predictions) {
    const existing = predictionsByRace.get(prediction.race_id) ?? []
    existing.push(prediction)
    predictionsByRace.set(prediction.race_id, existing)
  }

  const results: MatchResult[] = []
  let totalScore = 0
  let maxScore = 0
  let predictedRaces = 0

  for (const race of races) {
    const raceEntries = entriesByRace.get(race.id) ?? []
    if (!raceEntries.length) continue

    const racePredictions = predictionsByRace.get(race.id)
    if (!racePredictions || !racePredictions.length) continue

    const prediction = racePredictions.find(p =>
      p.model_version.includes('v4') || p.model_version.includes('v3')
    ) ?? racePredictions[0]

    const finished = raceEntries
      .filter((e) => e.status !== 'scratched' && e.finishing_position != null)
      .sort((a, b) => (a.finishing_position ?? 0) - (b.finishing_position ?? 0))

    if (!finished.length) continue

    const predictedPodium = prediction.predictions?.podium ?? prediction.predictions?.all_horses?.slice(0, 3) ?? []
    if (!predictedPodium.length) continue

    predictedRaces += 1

    const predictedIds = predictedPodium.map((h) => h.horse_id)
    const actualIds = finished.slice(0, 3).map((e) => e.horse_id)

    const winnerCorrect = predictedIds[0] === actualIds[0]
    const anyCorrect = predictedIds.some((id) => actualIds.includes(id))
    const exacta = actualIds.length >= 2 && predictedIds.slice(0, 2).every((id: string, i: number) => id === actualIds[i])
    const trifecta = actualIds.length >= 3 && predictedIds.slice(0, 3).every((id: string, i: number) => id === actualIds[i])
    const score = (winnerCorrect ? 3 : 0) + (exacta ? 2 : 0) + (trifecta ? 1 : 0) + (anyCorrect && !winnerCorrect ? 1 : 0)

    totalScore += score
    maxScore += 6

    const predictedWinner = raceEntries.find((e) => e.horse_id === predictedIds[0])
    const actualWinner = raceEntries.find((e) => e.horse_id === actualIds[0])
    const course = normaliseRacecourse(race.racecourse_id) ?? race.racecourse_id

    results.push({
      raceId: race.id,
      course,
      distance: race.distance_m,
      trackCondition: race.track_condition,
      fieldSize: raceEntries.length,
      isVictoria: normaliseRacecourse(race.racecourse_id) != null,
      predictedWinnerBarrier: predictedWinner?.barrier_number ?? null,
      predictedWinnerConfidence: prediction.confidence_scores?.winner ?? predictedPodium[0]?.win_probability ?? null,
      actualWinnerBarrier: actualWinner?.barrier_number ?? null,
      winnerCorrect,
      anyCorrect,
      score,
      modelVersion: prediction.model_version,
    })
  }

  console.log(`\n=== Pattern Analysis (${results.length} races) ===`)
  console.log(`Overall score: ${totalScore}/${maxScore} (${((totalScore / maxScore) * 100).toFixed(1)}%)`)

  console.log('\n--- By Distance ---')
  const byDistance: Record<string, { correct: number; total: number }> = {}
  for (const r of results) {
    if (!r.distance) continue
    const bucket = `${Math.round(r.distance / 200) * 200}m`
    if (!byDistance[bucket]) byDistance[bucket] = { correct: 0, total: 0 }
    byDistance[bucket].total += 1
    if (r.winnerCorrect) byDistance[bucket].correct += 1
  }
  Object.entries(byDistance)
    .sort(([, a], [, b]) => b.total - a.total)
    .forEach(([dist, stats]) => {
      console.log(`  ${dist}: ${(stats.correct / stats.total * 100).toFixed(1)}% (${stats.correct}/${stats.total})`)
    })

  console.log('\n--- By Track Condition ---')
  const byCondition = groupBy(results, 'trackCondition')
  Object.entries(byCondition)
    .sort(([, a], [, b]) => b.length - a.length)
    .forEach(([cond, rs]) => {
      const correct = rs.filter(r => r.winnerCorrect).length
      console.log(`  ${cond ?? 'Unknown'}: ${(correct / rs.length * 100).toFixed(1)}% (${correct}/${rs.length})`)
    })

  console.log('\n--- By Field Size ---')
  const byFieldSize: Record<string, { correct: number; total: number }> = {}
  for (const r of results) {
    if (!r.fieldSize) continue
    const bucket = r.fieldSize <= 8 ? '<=8' : r.fieldSize <= 12 ? '9-12' : r.fieldSize <= 16 ? '13-16' : '17+'
    if (!byFieldSize[bucket]) byFieldSize[bucket] = { correct: 0, total: 0 }
    byFieldSize[bucket].total += 1
    if (r.winnerCorrect) byFieldSize[bucket].correct += 1
  }
  Object.entries(byFieldSize).forEach(([size, stats]) => {
    console.log(`  ${size} runners: ${(stats.correct / stats.total * 100).toFixed(1)}% (${stats.correct}/${stats.total})`)
  })

  console.log('\n--- By Predicted Winner Barrier ---')
  const byBarrier: Record<number, { correct: number; total: number }> = {}
  for (const r of results) {
    if (r.predictedWinnerBarrier == null) continue
    if (!byBarrier[r.predictedWinnerBarrier]) byBarrier[r.predictedWinnerBarrier] = { correct: 0, total: 0 }
    byBarrier[r.predictedWinnerBarrier].total += 1
    if (r.winnerCorrect) byBarrier[r.predictedWinnerBarrier].correct += 1
  }
  Object.entries(byBarrier)
    .map(([b, s]) => ({ barrier: Number(b), acc: s.correct / s.total, correct: s.correct, total: s.total }))
    .sort((a, b) => a.barrier - b.barrier)
    .forEach(({ barrier, acc, correct, total }) => {
      console.log(`  Barrier ${barrier}: ${(acc * 100).toFixed(1)}% (${correct}/${total})`)
    })

  const withConfidence = results.filter(r => r.predictedWinnerConfidence != null)
  if (withConfidence.length) {
    console.log('\n--- By Confidence Level ---')
    const highConf = withConfidence.filter(r => (r.predictedWinnerConfidence ?? 0) >= 0.25)
    const lowConf = withConfidence.filter(r => (r.predictedWinnerConfidence ?? 0) < 0.25)
    const highCorrect = highConf.filter(r => r.winnerCorrect).length
    const lowCorrect = lowConf.filter(r => r.winnerCorrect).length
    console.log(`  High confidence (>=25%): ${(highCorrect / highConf.length * 100).toFixed(1)}% (${highCorrect}/${highConf.length})`)
    console.log(`  Low confidence (<25%): ${(lowCorrect / lowConf.length * 100).toFixed(1)}% (${lowCorrect}/${lowConf.length})`)
  }

  console.log('\n--- By Location ---')
  const vicRaces = results.filter(r => r.isVictoria)
  const otherRaces = results.filter(r => !r.isVictoria)
  const vicCorrect = vicRaces.filter(r => r.winnerCorrect).length
  const otherCorrect = otherRaces.filter(r => r.winnerCorrect).length
  console.log(`  Victoria: ${(vicCorrect / vicRaces.length * 100).toFixed(1)}% (${vicCorrect}/${vicRaces.length})`)
  console.log(`  Other: ${(otherCorrect / otherRaces.length * 100).toFixed(1)}% (${otherCorrect}/${otherRaces.length})`)

  console.log('\n--- Top 5 Courses by Accuracy ---')
  const byCourse = groupBy(results, 'course')
  Object.entries(byCourse)
    .map(([c, rs]) => ({ course: c, correct: rs.filter(r => r.winnerCorrect).length, total: rs.length }))
    .filter(s => s.total >= 10)
    .sort((a, b) => (b.correct / b.total) - (a.correct / a.total))
    .slice(0, 5)
    .forEach(({ course, correct, total }) => {
      console.log(`  ${course}: ${(correct / total * 100).toFixed(1)}% (${correct}/${total})`)
    })
}

analyzePatterns().catch((error) => {
  console.error('Analysis failed:', error)
  process.exit(1)
})
