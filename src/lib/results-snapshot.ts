import type { SupabaseClient } from '@supabase/supabase-js'
import type { PredictionPayload } from './types'
import { CURRENT_MODEL_VERSIONS, PRODUCTION_MODEL_VERSION } from './prediction-suite'

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
  id: string
  race_id: string
  model_version: string
  predictions: PredictionPayload
  confidence_scores: { winner?: number }
  predicted_at: string
}

export function selectCompletedResultPrediction(rows: ResultPrediction[]) {
  const candidates = rows.filter(row =>
    CURRENT_MODEL_VERSIONS.some(version => row.model_version === `${version}-retrospective`)
    && (row.predictions.podium ?? row.predictions.all_horses)?.length,
  ).sort((left, right) => right.predicted_at.localeCompare(left.predicted_at) || right.id.localeCompare(left.id))
  return candidates.find(row => row.model_version === `${PRODUCTION_MODEL_VERSION}-retrospective`) ?? candidates[0]
}

export async function loadResultPredictions(db: SupabaseClient, raceIds: string[]) {
  if (!raceIds.length) return []
  const rows: ResultPrediction[] = []
  for (let start = 0; ; start += 1000) {
    const response = await db.from('predictions').select('id, race_id, model_version, predictions, confidence_scores, predicted_at')
      .in('race_id', raceIds).in('model_version', CURRENT_MODEL_VERSIONS.map(version => `${version}-retrospective`))
      .order('predicted_at', { ascending: false }).order('id', { ascending: false }).range(start, start + 999)
    if (response.error) throw response.error
    rows.push(...response.data as ResultPrediction[])
    if (response.data.length < 1000) break
  }
  return raceIds.flatMap(raceId => {
    const prediction = selectCompletedResultPrediction(rows.filter(row => row.race_id === raceId))
    return prediction ? [{ ...prediction, predictions: { podium: prediction.predictions.podium ?? prediction.predictions.all_horses?.slice(0, 3) ?? [], all_horses: [] } }] : []
  })
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
    predictions.push(...await loadResultPredictions(db, ids))
  }
  return { races, entries, predictions }
}

export type ResultsSnapshot = Awaited<ReturnType<typeof loadResultsSnapshot>>