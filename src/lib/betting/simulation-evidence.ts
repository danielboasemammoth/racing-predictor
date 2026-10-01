import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyPick } from '../daily-picks'
import { CLASSIFICATION_RANK } from '../reliability-score'
import { MIN_RELIABILITY_FOR_AUTO_BET } from './simulation-presets'

export interface SimulationEvidence {
  predictionId: string
  horseId: string
  capturedAt: string
  reliability: number
  qualifiedWin: boolean
}

export function isQualifiedSimulationWin(pick: DailyPick): boolean {
  return !!pick.reliability && pick.reliability.score >= MIN_RELIABILITY_FOR_AUTO_BET
    && pick.reliability.vetoReason === null && CLASSIFICATION_RANK[pick.reliability.classification] >= CLASSIFICATION_RANK.Average
}

export async function recordSimulationEvidence(admin: SupabaseClient, pick: DailyPick, activeHorseIds: Set<string>, now: Date): Promise<boolean> {
  const { race, horse, reliability } = pick
  const prediction = race.prediction
  const minutes = (Date.parse(race.race_datetime) - now.getTime()) / 60_000
  if (!prediction?.id || !reliability || !Number.isFinite(reliability.score) || reliability.score < 0 || reliability.score > 100
    || race.status !== 'upcoming' || !(minutes >= 1 && minutes <= 180)
    || prediction.model_version.includes('retrospective') || !(Date.parse(prediction.predicted_at) <= now.getTime())) return false
  const field = prediction.predictions.all_horses
  if (field.length !== activeHorseIds.size || new Set(field.map(entry => entry.horse_id)).size !== field.length
    || !field.every(entry => activeHorseIds.has(entry.horse_id)) || prediction.predictions.podium[0]?.horse_id !== horse.horse_id) return false
  const payload: SimulationEvidence = { predictionId: prediction.id, horseId: horse.horse_id, capturedAt: now.toISOString(), reliability: reliability.score, qualifiedWin: isQualifiedSimulationWin(pick) }
  const result = await admin.from('analysis_snapshots').upsert({ kind: `simulator-evidence-v1:${prediction.id}`, payload, generated_at: payload.capturedAt }, { onConflict: 'kind', ignoreDuplicates: true })
  if (result.error) throw result.error
  return true
}