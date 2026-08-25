/**
 * One-off experiment: does band-based post-hoc probability calibration (bucket each horse's raw
 * win_probability by probabilityBand(), replace it with the empirical-Bayes shrunk strike rate
 * observed for that band, renormalize the field back to sum to 1) improve Brier score / log loss
 * on data the calibration table has never seen? Mirrors the same chronological 85/15
 * discovery/holdout discipline as scripts/reliability-analysis.ts - the calibration table is
 * built ONLY from the discovery slice and scored ONLY on the untouched holdout slice, so this is
 * not circular/in-sample. Read-only: no predictions or tables are changed.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { bucketize, probabilityBand, MIN_CREDIBLE_SAMPLE, type BucketStats } from '../src/lib/reliability-analysis'
import type { PredictionPayload } from '../src/lib/types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface HorseRow {
  raceId: string
  raceDatetime: string
  horseId: string
  rawProbability: number
  won: boolean
}

async function main() {
  const races: Array<{ id: string; race_datetime: string }> = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from('races')
      .select('id, race_datetime')
      .eq('status', 'completed')
      .range(offset, offset + 999)
    if (error) throw error
    races.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const raceDatetimeById = new Map(races.map((race) => [race.id, race.race_datetime]))
  const raceIds = races.map((race) => race.id)
  console.log(`Loaded ${raceIds.length} completed races`)

  const winnerByRace = new Map<string, string>()
  const predictionsByRace = new Map<string, PredictionPayload>()

  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const [entryResult, predictionResult] = await Promise.all([
      supabase.from('race_entries').select('race_id, horse_id, finishing_position').in('race_id', chunk),
      supabase.from('predictions').select('race_id, predictions').eq('model_version', 'v4.1-ensemble-retrospective').in('race_id', chunk),
    ])
    if (entryResult.error) throw entryResult.error
    if (predictionResult.error) throw predictionResult.error
    for (const entry of (entryResult.data ?? []) as Array<{ race_id: string; horse_id: string; finishing_position: number | null }>) {
      if (entry.finishing_position === 1) winnerByRace.set(entry.race_id, entry.horse_id)
    }
    for (const row of (predictionResult.data ?? []) as Array<{ race_id: string; predictions: PredictionPayload }>) {
      predictionsByRace.set(row.race_id, row.predictions)
    }
  }

  const horseRows: HorseRow[] = []
  for (const raceId of raceIds) {
    const winnerId = winnerByRace.get(raceId)
    const predictions = predictionsByRace.get(raceId)
    const raceDatetime = raceDatetimeById.get(raceId)
    if (!winnerId || !predictions?.all_horses?.length || !raceDatetime) continue
    for (const horse of predictions.all_horses) {
      const rawProbability = horse.win_probability ?? horse.confidence
      if (typeof rawProbability !== 'number') continue
      horseRows.push({ raceId, raceDatetime, horseId: horse.horse_id, rawProbability, won: horse.horse_id === winnerId })
    }
  }
  horseRows.sort((left, right) => left.raceDatetime.localeCompare(right.raceDatetime))

  const validationEnd = Math.floor(horseRows.length * 0.85)
  const discovery = horseRows.slice(0, validationEnd)
  const holdout = horseRows.slice(validationEnd)
  console.log(`Horse-level rows: ${horseRows.length} (discovery ${discovery.length}, holdout ${holdout.length})`)

  const calibrationBuckets = bucketize(discovery, (row) => probabilityBand(row.rawProbability), (row) => row.won)
  const bucketByLabel = new Map<string, BucketStats>(calibrationBuckets.map((bucket) => [bucket.label, bucket]))
  console.log('\nCalibration table (built from discovery slice only):')
  for (const bucket of calibrationBuckets) {
    console.log(`  ${bucket.label}: n=${bucket.n}, raw strike rate=${(bucket.strikeRate * 100).toFixed(1)}%, shrunk=${(bucket.shrunkStrikeRate * 100).toFixed(1)}%`)
  }

  function calibrate(rawProbability: number): number {
    const bucket = bucketByLabel.get(probabilityBand(rawProbability))
    if (!bucket || bucket.n < MIN_CREDIBLE_SAMPLE) return rawProbability
    return bucket.shrunkStrikeRate
  }

  const holdoutByRace = new Map<string, HorseRow[]>()
  for (const row of holdout) {
    const group = holdoutByRace.get(row.raceId) ?? []
    group.push(row)
    holdoutByRace.set(row.raceId, group)
  }

  let rawBrierSum = 0
  let calibratedBrierSum = 0
  let rawLogLossSum = 0
  let calibratedLogLossSum = 0
  let horseCount = 0
  let raceCount = 0

  for (const [, rows] of holdoutByRace) {
    if (rows.length < 2) continue
    raceCount += 1
    const calibratedRaw = rows.map((row) => calibrate(row.rawProbability))
    const calibratedTotal = calibratedRaw.reduce((sum, value) => sum + value, 0) || 1
    const calibratedNormalized = calibratedRaw.map((value) => value / calibratedTotal)

    rows.forEach((row, index) => {
      horseCount += 1
      rawBrierSum += (row.rawProbability - Number(row.won)) ** 2
      calibratedBrierSum += (calibratedNormalized[index] - Number(row.won)) ** 2
      if (row.won) {
        rawLogLossSum += -Math.log(Math.max(row.rawProbability, 1e-9))
        calibratedLogLossSum += -Math.log(Math.max(calibratedNormalized[index], 1e-9))
      }
    })
  }

  console.log(`\nHoldout races scored: ${raceCount} (${horseCount} horse-level rows)`)
  console.log(`Raw Brier score:        ${(rawBrierSum / horseCount).toFixed(5)}`)
  console.log(`Calibrated Brier score: ${(calibratedBrierSum / horseCount).toFixed(5)}`)
  console.log(`Raw winner log loss:        ${(rawLogLossSum / raceCount).toFixed(5)}`)
  console.log(`Calibrated winner log loss: ${(calibratedLogLossSum / raceCount).toFixed(5)}`)
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
