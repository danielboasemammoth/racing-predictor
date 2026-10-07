import type { SupabaseClient } from '@supabase/supabase-js'
import { readPages } from './supabase/read-pages'
import type { Prediction, Race } from './types'
import { PRODUCTION_MODEL_VERSION } from './prediction-suite'
import { candidatesForDate, DEFAULT_PICKS_MIN_PCT, DEFAULT_PICKS_SORT, melbourneDateKey, sortDailyPicks, type DailyPick } from './daily-picks'
import type { HomePicksArchive, RecordedHomePick } from './home-picks-archive'

export interface HistoricalDailyPick extends DailyPick {
  provenance: 'home-snapshot' | 'pre-race-recovery'
  observedAt: string
  predictionId: string
  tabPrice?: RecordedHomePick['tabPrice']
  tabPriceStatus?: RecordedHomePick['tabPriceStatus']
  actualPosition: number | null
  scratched: boolean
  won: boolean
  placedTop3: boolean
}

export interface DailyPicksHistoryDay {
  dateKey: string
  picks: HistoricalDailyPick[]
}

export interface DailyPicksHistoryOptions {
  days?: number
}

export async function loadDailyPicksHistory(db: SupabaseClient, options: DailyPicksHistoryOptions = {}): Promise<DailyPicksHistoryDay[]> {
  const now = new Date()
  const since = new Date(now.getTime() - (options.days ?? 7) * 86_400_000)
  const races = await readPages((after, limit) => {
    let query = db.from('races').select('*, racecourses(*)').eq('status', 'completed')
      .gte('race_datetime', since.toISOString()).lte('race_datetime', now.toISOString()).order('id').limit(limit)
    if (after) query = query.gt('id', after)
    return query
  }) as Race[]
  if (!races.length) return []
  const raceById = new Map(races.map(race => [race.id, race]))
  const archives = await readPages((after, limit) => {
    let query = db.from('analysis_snapshots').select('id, payload, generated_at').like('kind', 'home-picks-v1:%')
      .gte('generated_at', new Date(since.getTime() - 2 * 86_400_000).toISOString()).lte('generated_at', now.toISOString()).order('id').limit(limit)
    if (after) query = query.gt('id', after)
    return query
  })
  const coveredDates = new Map<string, number>()
  const selected = new Map<string, HistoricalDailyPick>()
  for (const row of archives.sort((left, right) => left.generated_at.localeCompare(right.generated_at) || left.id.localeCompare(right.id))) {
    const archive = row.payload as HomePicksArchive
    if (archive.schema !== 1 || !Array.isArray(archive.picks) || !Array.isArray(archive.dateKeys)) throw new Error('Invalid home picks archive')
    for (const dateKey of archive.dateKeys) {
      const recordedAt = Date.parse(row.generated_at)
      coveredDates.set(dateKey, Math.min(coveredDates.get(dateKey) ?? Infinity, recordedAt))
    }
    for (const pick of archive.picks) {
      const key = `${pick.race.id}|${pick.horse.horse_id}`
      if (!raceById.has(pick.race.id) || selected.has(key) || !(Date.parse(pick.observedAt) < Date.parse(pick.race.race_datetime))) continue
      selected.set(key, { ...pick, actualPosition: null, scratched: false, won: false, placedTop3: false })
    }
  }

  const entryRows: Array<{ race_id: string; horse_id: string; finishing_position: number | null; status: string }> = []
  const forecasts: Array<{ id: string; race_id: string; model_version: string; predicted_at: string; created_at: string; podium: Prediction['predictions']['podium'] | null }> = []
  const raceIds = races.map(race => race.id)
  for (let offset = 0; offset < raceIds.length; offset += 10) {
    const chunk = raceIds.slice(offset, offset + 10)
    const recoveryIds = chunk.filter(id => {
      const race = raceById.get(id)!
      return !((coveredDates.get(melbourneDateKey(race.race_datetime)) ?? Infinity) < Date.parse(race.race_datetime))
    })
    const [predictionRows, entries] = await Promise.all([
      recoveryIds.length ? readPages((after, limit) => {
        let query = db.from('predictions').select('id, race_id, model_version, predicted_at, created_at, podium:predictions->podium')
          .in('race_id', recoveryIds).eq('model_version', PRODUCTION_MODEL_VERSION).order('id').limit(limit)
        if (after) query = query.gt('id', after)
        return query
      }) : Promise.resolve([]),
      readPages((after, limit) => {
        let query = db.from('race_entries').select('id, race_id, horse_id, finishing_position, status').in('race_id', chunk).order('id').limit(limit)
        if (after) query = query.gt('id', after)
        return query
      }),
    ])
    forecasts.push(...predictionRows as typeof forecasts)
    entryRows.push(...entries)
  }

  for (const forecast of forecasts.sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))) {
    const race = raceById.get(forecast.race_id)
    if (!race || forecast.model_version !== PRODUCTION_MODEL_VERSION || !forecast.podium?.length) continue
    const start = Date.parse(race.race_datetime)
    if (!(Date.parse(forecast.predicted_at) < start && Date.parse(forecast.created_at) < start)) continue
    const prediction: Prediction = {
      id: forecast.id, race_id: race.id, model_version: forecast.model_version, predicted_at: forecast.predicted_at,
      predictions: { podium: forecast.podium, all_horses: [] }, confidence_scores: { overall: 0 }, predicted_times: {},
    }
    const [pick] = candidatesForDate([{ ...race, prediction, model_predictions: [] }], melbourneDateKey(race.race_datetime), { skipQualificationGate: true })
    if (!pick || !Number.isFinite(pick.winProbability) || pick.winProbability < DEFAULT_PICKS_MIN_PCT / 100 || pick.winProbability > 1) continue
    const key = `${race.id}|${pick.horse.horse_id}`
    if (selected.has(key)) continue
    selected.set(key, { ...pick, provenance: 'pre-race-recovery', observedAt: forecast.created_at, predictionId: forecast.id,
      actualPosition: null, scratched: false, won: false, placedTop3: false })
  }

  const results = new Map(entryRows.map(entry => [`${entry.race_id}|${entry.horse_id}`, entry]))
  const days = new Map<string, HistoricalDailyPick[]>()
  for (const [key, pick] of selected) {
    const result = results.get(key)
    const actualPosition = result?.finishing_position ?? null
    const scratched = result?.status === 'scratched'
    const dateKey = melbourneDateKey(pick.race.race_datetime)
    const picks = days.get(dateKey) ?? []
    picks.push({ ...pick, actualPosition, scratched, won: !scratched && actualPosition === 1,
      placedTop3: !scratched && actualPosition !== null && actualPosition >= 1 && actualPosition <= 3 })
    days.set(dateKey, picks)
  }
  return [...days].sort(([left], [right]) => right.localeCompare(left)).map(([dateKey, picks]) => ({
    dateKey, picks: sortDailyPicks(picks, DEFAULT_PICKS_SORT) as HistoricalDailyPick[],
  }))
}