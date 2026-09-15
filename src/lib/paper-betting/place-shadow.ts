import type { SupabaseClient } from '@supabase/supabase-js'
import type { RaceWithPrediction } from '@/lib/types'
import { buildPlaceStudyRace, PLACE_STUDY_VALUE_RULES, scorePlaceStudy, shrinkPlaceProbability, type PlaceStudyEntry, type PlaceStudyRace } from '@/lib/betting/place-calibration-study'

export const PLACE_SHADOW_VERSION = 'place-shrinkage-shadow-v1'
export const PLACE_SHADOW_SOURCE_MODEL = 'v6-market-blend'
export const PLACE_SHADOW_STRENGTH = 0.3345894804013903
export const PLACE_SHADOW_START = '2026-09-15T14:00:00.000Z'
export const PLACE_SHADOW_PREFIX = `${PLACE_SHADOW_VERSION}:`

export interface PlaceShadowSnapshot {
  version: typeof PLACE_SHADOW_VERSION
  strength: number
  capturedAt: string
  race: { id: string; startTime: string }
  prediction: NonNullable<RaceWithPrediction['prediction']>
  correctedProbabilities: Array<{ horseId: string; probability: number }>
}

export function createPlaceShadowSnapshot(race: RaceWithPrediction, activeHorseIds: Set<string>, now: Date): PlaceShadowSnapshot | null {
  const prediction = race.prediction
  const minutes = (Date.parse(race.race_datetime) - now.getTime()) / 60_000
  if (now.getTime() < Date.parse(PLACE_SHADOW_START) || race.status !== 'upcoming' || minutes < 1 || minutes > 180 || !Number.isFinite(minutes)) return null
  if (!prediction || prediction.model_version !== PLACE_SHADOW_SOURCE_MODEL
    || !Number.isFinite(Date.parse(prediction.predicted_at)) || Date.parse(prediction.predicted_at) > now.getTime()) return null
  const horses = prediction.predictions.all_horses ?? []
  if (activeHorseIds.size < 8 || horses.length !== activeHorseIds.size
    || new Set(horses.map((horse) => horse.horse_id)).size !== activeHorseIds.size
    || !horses.every((horse) => activeHorseIds.has(horse.horse_id))) return null
  if (horses.some((horse) => horse.top3_probability == null || !Number.isFinite(horse.top3_probability) || horse.top3_probability < 0 || horse.top3_probability > 1)
    || Math.abs(horses.reduce((sum, horse) => sum + (horse.top3_probability ?? 0), 0) - 3) > 0.001) return null
  return {
    version: PLACE_SHADOW_VERSION,
    strength: PLACE_SHADOW_STRENGTH,
    capturedAt: now.toISOString(),
    race: { id: race.id, startTime: race.race_datetime },
    prediction: {
      ...prediction,
      predictions: {
        podium: [],
        all_horses: horses.map((horse) => ({
          horse_id: horse.horse_id, horse_name: horse.horse_name, predicted_position: horse.predicted_position,
          confidence: horse.confidence, top3_probability: horse.top3_probability,
          place_odds: horse.place_odds, place_odds_source: horse.place_odds_source,
        })),
      },
      predicted_times: {},
      actual_results: undefined,
      accuracy_score: undefined,
    },
    correctedProbabilities: horses.map((horse) => ({ horseId: horse.horse_id, probability: shrinkPlaceProbability(horse.top3_probability!, horses.length, PLACE_SHADOW_STRENGTH) })),
  }
}

export async function recordPlaceShadow(admin: SupabaseClient, race: RaceWithPrediction, activeHorseIds: Set<string>, now: Date) {
  const snapshot = createPlaceShadowSnapshot(race, activeHorseIds, now)
  if (!snapshot) return false
  const result = await admin.from('analysis_snapshots').upsert({
    kind: `${PLACE_SHADOW_PREFIX}${race.id}`,
    payload: snapshot,
    generated_at: snapshot.capturedAt,
  }, { onConflict: 'kind', ignoreDuplicates: true }).select('id')
  if (result.error) throw result.error
  return (result.data?.length ?? 0) > 0
}

export function resolvePlaceShadow(snapshot: PlaceShadowSnapshot, race: { id: string; race_datetime: string }, entries: PlaceStudyEntry[]) {
  if (snapshot.version !== PLACE_SHADOW_VERSION || snapshot.strength !== PLACE_SHADOW_STRENGTH
    || snapshot.prediction.model_version !== PLACE_SHADOW_SOURCE_MODEL || snapshot.race.id !== race.id
    || !Number.isFinite(Date.parse(snapshot.capturedAt)) || Date.parse(snapshot.capturedAt) < Date.parse(PLACE_SHADOW_START)
    || Date.parse(snapshot.capturedAt) >= Date.parse(race.race_datetime)
    || Date.parse(snapshot.prediction.predicted_at) > Date.parse(snapshot.capturedAt)) return { sample: null, reason: 'invalid_shadow_provenance' }
  const result = buildPlaceStudyRace(race, [snapshot.prediction], entries)
  if (result.sample && (snapshot.correctedProbabilities.length !== result.sample.runners.length
    || result.sample.runners.some((runner) => {
      const recorded = snapshot.correctedProbabilities.find((row) => row.horseId === runner.horseId)?.probability
      return recorded == null || !Number.isFinite(recorded)
        || Math.abs(recorded - shrinkPlaceProbability(runner.probability, result.sample!.runners.length, PLACE_SHADOW_STRENGTH)) > 1e-10
    }))) return { sample: null, reason: 'changed_shadow_candidate' }
  return result
}

export function summarizePlaceShadow(samples: PlaceStudyRace[]) {
  const raw = scorePlaceStudy(samples, 0)
  const corrected = scorePlaceStudy(samples, PLACE_SHADOW_STRENGTH)
  return {
    version: PLACE_SHADOW_VERSION,
    strength: PLACE_SHADOW_STRENGTH,
    raw,
    valueRules: PLACE_STUDY_VALUE_RULES,
    corrected,
    probabilityReviewReady: samples.length >= 100,
    selectedValueReviewReady: corrected.valueSelections.races >= 30,
    productionChanged: false,
  }
}

export async function loadPlaceShadowReport(admin: SupabaseClient) {
  const snapshots: PlaceShadowSnapshot[] = []
  for (let offset = 0; ; offset += 1000) {
    const result = await admin.from('analysis_snapshots').select('payload').like('kind', `${PLACE_SHADOW_PREFIX}%`)
      .order('kind').range(offset, offset + 999)
    if (result.error) throw result.error
    snapshots.push(...result.data.map((row) => row.payload as PlaceShadowSnapshot))
    if (result.data.length < 1000) break
  }
  const samples: PlaceStudyRace[] = []
  const exclusions: Record<string, number> = {}
  let pending = 0
  for (let offset = 0; offset < snapshots.length; offset += 20) {
    const chunk = snapshots.slice(offset, offset + 20)
    const ids = chunk.map((snapshot) => snapshot.race.id)
    const [races, entries] = await Promise.all([
      admin.from('races').select('id,race_datetime,status').in('id', ids),
      admin.from('race_entries').select('race_id,horse_id,status,finishing_position').in('race_id', ids),
    ])
    if (races.error) throw races.error
    if (entries.error) throw entries.error
    if (entries.data.length >= 1000) throw new Error('Shadow result query hit row limit; reduce the batch size')
    for (const snapshot of chunk) {
      const race = races.data.find((row) => row.id === snapshot.race.id)
      if (race && ['upcoming', 'live'].includes(race.status)) { pending += 1; continue }
      const result = race?.status === 'completed'
        ? resolvePlaceShadow(snapshot, race, entries.data.filter((entry) => entry.race_id === race.id))
        : { sample: null, reason: 'cancelled_or_missing_race' }
      if (result.sample) samples.push(result.sample)
      else exclusions[result.reason!] = (exclusions[result.reason!] ?? 0) + 1
    }
  }
  return { captured: snapshots.length, pending, exclusions, ...summarizePlaceShadow(samples) }
}