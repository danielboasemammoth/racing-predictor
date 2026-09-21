import type { SupabaseClient } from '@supabase/supabase-js'
import type { PredictionPayload } from './types'

export interface ResultEntry {
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
  horses: unknown
}

export interface ResultPrediction {
  race_id: string
  predictions: PredictionPayload
  confidence_scores: { winner?: number }
  predicted_at: string
}

export async function loadResultsSnapshot(db: SupabaseClient) {
  const result = await db.from('races').select('id, racecourse_id, race_datetime, distance_m, track_condition, race_class, status, racecourses(name)')
    .eq('status', 'completed').gte('race_datetime', new Date(Date.now() - 48 * 60 * 60_000).toISOString())
    .order('race_datetime', { ascending: false }).limit(50)
  if (result.error) throw result.error
  const races = (result.data ?? []).map(race => ({
    ...race, racecourseName: (Array.isArray(race.racecourses) ? race.racecourses[0] : race.racecourses)?.name ?? race.racecourse_id,
  }))
  const entries: ResultEntry[] = []
  const predictions: ResultPrediction[] = []
  for (let offset = 0; offset < races.length; offset += 10) {
    const batch = races.slice(offset, offset + 10)
    const ids = batch.map(race => race.id)
    for (let start = 0; ; start += 1000) {
      const response = await db.from('race_entries')
        .select('race_id, horse_id, finishing_position, finishing_time, margin, barrier_number, weight_carried, jockey, trainer, status, horses(name)')
        .in('race_id', ids).order('id').range(start, start + 999)
      if (response.error) throw response.error
      entries.push(...response.data as ResultEntry[])
      if (response.data.length < 1000) break
    }
    const latest = new Map<string, ResultPrediction>()
    for (let start = 0; ; start += 1000) {
      const response = await db.from('predictions').select('race_id, predictions, confidence_scores, predicted_at')
        .in('race_id', ids)
        .order('predicted_at', { ascending: false }).order('id').range(start, start + 999)
      if (response.error) throw response.error
      for (const prediction of response.data as ResultPrediction[]) {
        const race = batch.find(race => race.id === prediction.race_id)!
        if (!latest.has(race.id)) {
          latest.set(race.id, { ...prediction, predictions: { podium: prediction.predictions.podium ?? prediction.predictions.all_horses?.slice(0, 3) ?? [], all_horses: [] } })
        }
      }
      if (response.data.length < 1000 || latest.size === ids.length) break
    }
    predictions.push(...latest.values())
  }
  return { races, entries, predictions }
}

export type ResultsSnapshot = Awaited<ReturnType<typeof loadResultsSnapshot>>