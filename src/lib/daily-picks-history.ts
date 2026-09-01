import type { SupabaseClient } from '@supabase/supabase-js'
import type { Prediction, Race, RaceWithPrediction } from '@/lib/types'
import { CURRENT_MODEL_VERSIONS } from '@/lib/prediction-suite'
import { candidatesForDate, melbourneDateKey, type DailyPick, type DailyPicksFilterOptions } from '@/lib/daily-picks'

export interface HistoricalDailyPick extends DailyPick {
  actualPosition: number | null
  scratched: boolean
  won: boolean
  placedTop3: boolean
}

export interface DailyPicksHistoryDay {
  dateKey: string
  picks: HistoricalDailyPick[]
}

export interface DailyPicksHistoryOptions extends DailyPicksFilterOptions {
  /** How many days back (Melbourne time) to reconstruct picks for. */
  days?: number
}

/**
 * Reconstructs what the daily shortlist would have shown on each past day, using the same
 * ranking logic as the live homepage but against completed races and their retrospective
 * predictions, then joins in the actual finishing result for every picked horse. There is no
 * stored record of exactly what was rendered live each day, so this is a faithful replay rather
 * than a literal historical log - it can only differ from what was actually shown if a race's
 * runners changed after the live prediction was generated (which retrospective predictions
 * already account for).
 */
export async function loadDailyPicksHistory(
  supabase: SupabaseClient,
  options: DailyPicksHistoryOptions = {},
): Promise<DailyPicksHistoryDay[]> {
  const days = options.days ?? 14
  const now = new Date()
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const { data: races, error: racesError } = await supabase
    .from('races')
    .select('*, racecourses(*)')
    .eq('status', 'completed')
    .gte('race_datetime', since.toISOString())
    .lte('race_datetime', now.toISOString())
    .order('race_datetime', { ascending: false })
    .limit(1000)

  if (racesError) throw racesError
  const typedRaces = (races ?? []) as Race[]
  if (typedRaces.length === 0) return []

  const raceIds = typedRaces.map((race) => race.id)

  // A large date range can cover hundreds of races - chunk the .in() lookups so the request URL
  // never grows large enough to trip a "Bad Request" from Postgrest/the edge proxy.
  const CHUNK_SIZE = 100
  const chunks: string[][] = []
  for (let offset = 0; offset < raceIds.length; offset += CHUNK_SIZE) {
    chunks.push(raceIds.slice(offset, offset + CHUNK_SIZE))
  }

  const predictionRows: Prediction[] = []
  const entryRows: Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string }> = []
  for (const chunk of chunks) {
    const [predictionResult, entryResult] = await Promise.all([
      supabase.from('predictions').select('*').in('race_id', chunk).order('predicted_at', { ascending: false }),
      supabase.from('race_entries').select('race_id, horse_id, finishing_position, status').in('race_id', chunk),
    ])
    if (predictionResult.error) throw predictionResult.error
    if (entryResult.error) throw entryResult.error
    predictionRows.push(...(predictionResult.data as Prediction[]))
    entryRows.push(...(entryResult.data as Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string }>))
  }

  // Completed races must use retrospective predictions (built only from pre-race history) -
  // the live predictions for the same race can be stale (e.g. still including a horse that was
  // scratched afterwards). Mirrors the same preference used on the race detail page.
  const modelsByRace = new Map<string, Prediction[]>()
  for (const prediction of predictionRows) {
    if (!prediction.model_version.includes('retrospective')) continue
    const baseVersion = prediction.model_version.replace('-retrospective', '')
    if (!CURRENT_MODEL_VERSIONS.includes(baseVersion)) continue
    const models = modelsByRace.get(prediction.race_id) ?? []
    if (!models.some((model) => model.model_version.replace('-retrospective', '') === baseVersion)) models.push(prediction)
    modelsByRace.set(prediction.race_id, models)
  }

  const racesWithPredictions: RaceWithPrediction[] = typedRaces.map((race) => {
    const models = modelsByRace.get(race.id) ?? []
    const primary = models.find((model) => model.model_version.replace('-retrospective', '') === 'v4.1-ensemble')
      ?? models[0]
      ?? null
    return { ...race, prediction: primary, model_predictions: models }
  })

  const resultByRaceHorse = new Map<string, { finishingPosition: number | null; scratched: boolean }>()
  for (const entry of entryRows) {
    resultByRaceHorse.set(`${entry.race_id}|${entry.horse_id}`, {
      finishingPosition: entry.finishing_position,
      scratched: entry.status === 'scratched',
    })
  }

  const racesByDate = new Map<string, RaceWithPrediction[]>()
  for (const race of racesWithPredictions) {
    const dateKey = melbourneDateKey(race.race_datetime)
    const bucket = racesByDate.get(dateKey) ?? []
    bucket.push(race)
    racesByDate.set(dateKey, bucket)
  }

  const days_: DailyPicksHistoryDay[] = []
  for (const [dateKey, racesForDate] of racesByDate) {
    const picks = candidatesForDate(racesForDate, dateKey, options).slice(0, 3).map((pick): HistoricalDailyPick => {
      const result = resultByRaceHorse.get(`${pick.race.id}|${pick.horse.horse_id}`)
      const finishingPosition = result?.finishingPosition ?? null
      return {
        ...pick,
        actualPosition: finishingPosition,
        scratched: result?.scratched ?? false,
        won: finishingPosition === 1,
        placedTop3: finishingPosition !== null && finishingPosition <= 3,
      }
    })
    if (picks.length) days_.push({ dateKey, picks })
  }

  return days_.sort((left, right) => right.dateKey.localeCompare(left.dateKey))
}
