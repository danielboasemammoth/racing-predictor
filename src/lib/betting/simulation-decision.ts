import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyPick } from '../daily-picks'
import type { PredictedHorse } from '../types'
import { getTabPricesForInternalRaces, type TabPrice } from '../paper-betting/internal-tab-odds'
import { normalizeHorseName } from '../paper-betting/fundamentals-bridge'
import { isSimulationDecisionQuote } from './historical-simulator'
import { isQualifiedSimulationWin } from './simulation-evidence'
import type { SimulationSource } from './simulation-source'

export interface SimulationDecision {
  schema: 1
  raceId: string
  start: string
  capturedAt: string
  forecast: SimulationSource['forecasts'][number]
  prices: Record<string, TabPrice>
}

export function simulationDecisionKey(raceId: string, model: string) {
  return `simulator-decision-v1:${raceId}:${model}`
}

function frozenHorse(horse: PredictedHorse): PredictedHorse {
  return { horse_id: horse.horse_id, horse_name: horse.horse_name, predicted_position: horse.predicted_position,
    confidence: horse.confidence, win_probability: horse.win_probability, top3_probability: horse.top3_probability }
}

export async function recordSimulationDecision(admin: SupabaseClient, pick: DailyPick, activeHorseIds: Set<string>, now: Date): Promise<boolean> {
  const { race, horse, reliability } = pick
  const prediction = race.prediction
  const capturedAt = now.toISOString()
  const minutes = (Date.parse(race.race_datetime) - now.getTime()) / 60_000
  if (!prediction || !reliability || !Number.isFinite(reliability.score) || reliability.score < 0 || reliability.score > 100
    || race.status !== 'upcoming' || !(minutes >= 1 && minutes <= 180) || prediction.model_version.includes('retrospective')
    || !(Date.parse(prediction.predicted_at) <= now.getTime())) return false
  const field = prediction.predictions.all_horses
  const names = field.map(entry => normalizeHorseName(entry.horse_name))
  if (field.length !== activeHorseIds.size || new Set(field.map(entry => entry.horse_id)).size !== field.length
    || new Set(names).size !== names.length || !field.every(entry => activeHorseIds.has(entry.horse_id))
    || prediction.predictions.podium[0]?.horse_id !== horse.horse_id) return false
  const kind = simulationDecisionKey(race.id, prediction.model_version)
  const existing = await admin.from('analysis_snapshots').select('kind').eq('kind', kind).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return false
  const stored = await admin.from('predictions').select('created_at').eq('id', prediction.id).eq('race_id', race.id).maybeSingle()
  if (stored.error) throw stored.error
  if (!stored.data || !(Date.parse(stored.data.created_at) <= now.getTime())) return false
  const quotes = await getTabPricesForInternalRaces(admin, [{ id: race.id, racecourseName: race.racecourses?.name ?? '', raceNumber: race.race_number, raceDatetime: race.race_datetime }], false, capturedAt)
  const prices: Record<string, TabPrice> = {}
  for (const runner of field) {
    const price = quotes.get(race.id)?.get(normalizeHorseName(runner.horse_name))
    if (price && isSimulationDecisionQuote(race.race_datetime, capturedAt, price.quotedAt, price.capturedAt)
      && [price.win, price.place].some(value => typeof value === 'number' && Number.isFinite(value) && value > 1)) prices[runner.horse_id] = price
  }
  if (!Object.keys(prices).length) return false
  const payload: SimulationDecision = { schema: 1, raceId: race.id, start: race.race_datetime, capturedAt, prices,
    forecast: { id: prediction.id, model: prediction.model_version, predictedAt: prediction.predicted_at, createdAt: stored.data.created_at,
      podium: prediction.predictions.podium.map(frozenHorse), allHorses: field.map(frozenHorse), field: field.map(entry => entry.horse_id),
      evidence: { predictionId: prediction.id, horseId: horse.horse_id, capturedAt, reliability: reliability.score, qualifiedWin: isQualifiedSimulationWin(pick) } } }
  const result = await admin.from('analysis_snapshots').upsert({ kind, generated_at: capturedAt, payload }, { onConflict: 'kind', ignoreDuplicates: true }).select('kind')
  if (result.error) throw result.error
  return !!result.data?.length
}