import type { SupabaseClient } from '@supabase/supabase-js'
import type { Race, RaceWithPrediction, Prediction } from '@/lib/types'
import { CURRENT_MODEL_VERSIONS, PRODUCTION_MODEL_VERSION } from '@/lib/prediction-suite'

function melbourneUtcOffsetMinutes(reference: Date) {
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Melbourne',
    timeZoneName: 'longOffset',
  }).formatToParts(reference).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+10:00'
  const match = /GMT([+-]\d{2}):?(\d{2})?/.exec(offsetName)
  if (!match) return 600
  const hours = Number(match[1])
  const minutes = Number(match[2] ?? '0')
  return hours * 60 + (hours < 0 ? -minutes : minutes)
}

/** UTC instant of local midnight in Melbourne for the given YYYY-MM-DD date, accounting for daylight saving. */
function melbourneMidnightUtc(dateKey: string, reference: Date) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const offsetMinutes = melbourneUtcOffsetMinutes(reference)
  return new Date(Date.UTC(year, month - 1, day) - offsetMinutes * 60_000)
}

/**
 * Upcoming races (through tomorrow, Melbourne time) joined with each race's current-champion
 * prediction plus every other current model version's prediction for comparison. Shared by the
 * home page and the reliability auto-bet pipeline so both see identical candidates.
 */
export async function getUpcomingRaces(supabase: SupabaseClient): Promise<RaceWithPrediction[]> {
  // National racing volume can exceed a simple row cap, so bound the window to "through tomorrow"
  // (Melbourne time) instead, with a high safety-net limit rather than an arbitrary small count.
  const now = new Date()
  const dayAfterTomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
  const dayAfterTomorrowKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dayAfterTomorrow)
  const endOfTomorrow = melbourneMidnightUtc(dayAfterTomorrowKey, now)

  const { data: races, error: racesError } = await supabase
    .from('races')
    .select('*, racecourses(*)')
    .eq('status', 'upcoming')
    .gte('race_datetime', now.toISOString())
    .lt('race_datetime', endOfTomorrow.toISOString())
    .order('race_datetime', { ascending: true })
    .limit(300)

  if (racesError) throw racesError

  const typedRaces = (races ?? []) as Race[]
  if (typedRaces.length === 0) return []

  const predictionMap = new Map<string, Prediction>()
  const modelsByRace = new Map<string, Prediction[]>()
  for (let batch = 0; batch < typedRaces.length; batch += 20) {
    const raceIds = typedRaces.slice(batch, batch + 20).map(race => race.id)
    const latest = new Map<string, Pick<Prediction, 'id' | 'race_id' | 'model_version' | 'predicted_at'>>()
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from('predictions').select('id, race_id, model_version, predicted_at')
        .in('race_id', raceIds).in('model_version', CURRENT_MODEL_VERSIONS)
        .order('predicted_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + 999)
      if (error) throw error
      const predictions = (data ?? []) as Array<Pick<Prediction, 'id' | 'race_id' | 'model_version' | 'predicted_at'>>
      for (const prediction of predictions) {
        const key = `${prediction.race_id}:${prediction.model_version}`
        if (!latest.has(key)) latest.set(key, prediction)
      }
      if (predictions.length < 1000 || latest.size === raceIds.length * CURRENT_MODEL_VERSIONS.length) break
    }
    const selectedIds = [...latest.values()].map(prediction => prediction.id)
    for (let offset = 0; offset < selectedIds.length; offset += 20) {
      const { data, error } = await supabase.from('predictions').select('*').in('id', selectedIds.slice(offset, offset + 20))
      if (error) throw error
      for (const prediction of (data ?? []) as Prediction[]) {
        const models = modelsByRace.get(prediction.race_id) ?? []
        models.push(prediction)
        modelsByRace.set(prediction.race_id, models)
      }
    }
  }

  for (const [raceId, models] of modelsByRace) {
    const primary = models.find((model) => model.model_version === PRODUCTION_MODEL_VERSION) ?? models[0]
    if (primary) predictionMap.set(raceId, primary)
  }

  return typedRaces.map((race) => ({
    ...race,
    prediction: predictionMap.get(race.id) || null,
    model_predictions: modelsByRace.get(race.id) ?? [],
  }))
}
