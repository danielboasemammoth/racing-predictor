import type { SupabaseClient } from '@supabase/supabase-js'
import { candidatesForDate, DEFAULT_PICKS_MIN_PCT, DEFAULT_PICKS_SORT, filterDailyPicksByThreshold, melbourneDateKey, sortDailyPicks, type DailyPick } from './daily-picks'
import type { HomeSnapshot } from './page-snapshot-loaders'

export interface RecordedHomePick extends DailyPick {
  provenance: 'home-snapshot'
  observedAt: string
  predictionId: string
}

export interface HomePicksArchive {
  schema: 1
  snapshotAt: string
  observedAt: string
  dateKeys: string[]
  picks: RecordedHomePick[]
}

export function homePicksArchive(snapshot: HomeSnapshot, snapshotAt: string, observedAt = new Date().toISOString()): HomePicksArchive {
  const today = melbourneDateKey(observedAt)
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const tabIds = new Set(snapshot.tabRaceIds)
  const races = snapshot.races.filter(race => tabIds.has(race.id) && race.status === 'upcoming'
    && Date.parse(race.race_datetime) > Date.parse(observedAt)
    && race.prediction && !race.prediction.model_version.includes('retrospective')
    && Date.parse(race.prediction.predicted_at) <= Date.parse(observedAt))
  const picks = [today, tomorrow].flatMap(dateKey => {
    const candidates = candidatesForDate(races, dateKey, { reliabilityByRace: snapshot.reliabilityByRace })
    return sortDailyPicks(filterDailyPicksByThreshold(candidates, DEFAULT_PICKS_SORT, DEFAULT_PICKS_MIN_PCT), DEFAULT_PICKS_SORT)
  }).map((pick): RecordedHomePick => ({
    ...pick,
    race: { ...pick.race, prediction: null, model_predictions: [] },
    provenance: 'home-snapshot', observedAt, predictionId: pick.race.prediction!.id,
  }))
  return { schema: 1, snapshotAt, observedAt, dateKeys: [today, tomorrow], picks }
}

export async function recordHomePicks(db: SupabaseClient, data: unknown, snapshotAt: string) {
  if (!data || typeof data !== 'object' || !('races' in data) || !Array.isArray(data.races)) return
  const payload = homePicksArchive(data as HomeSnapshot, snapshotAt)
  const { error } = await db.from('analysis_snapshots').upsert({
    kind: `home-picks-v1:${snapshotAt}`, generated_at: payload.observedAt, payload,
  }, { onConflict: 'kind', ignoreDuplicates: true })
  if (error) throw error
}