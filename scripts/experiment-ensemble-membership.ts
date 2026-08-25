/**
 * One-off experiment: does averaging all four base model configs (v4-baseline, v4-context-form,
 * v4-connections, v4-optimized) into the ensemble beat the current production ensemble, which
 * only averages v4-optimized + v4-connections? Reuses the exact same combination logic as
 * runEnsemble() in prediction-suite.ts and the exact same scoring logic as evaluatePrediction()
 * in backtest.ts, replayed over the existing retrospective predictions for completed races - no
 * new predictions are generated and nothing in the app is changed.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { evaluatePrediction, type ActualRaceEntry } from '../src/lib/backtest'
import type { PredictedHorse, PredictionPayload } from '../src/lib/types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const BASE_VERSIONS = ['v4-baseline', 'v4-context-form', 'v4-connections', 'v4-optimized']

// Mirrors runEnsemble()'s combination step in src/lib/prediction-suite.ts exactly.
function combineEnsemble(components: PredictionPayload[]): PredictionPayload {
  const horseProbabilities = new Map<string, { horse: PredictedHorse; win: number; top3: number; count: number }>()
  for (const predictions of components) {
    for (const horse of predictions.all_horses) {
      const current = horseProbabilities.get(horse.horse_id) ?? { horse, win: 0, top3: 0, count: 0 }
      current.win += horse.win_probability ?? horse.confidence
      current.top3 += horse.top3_probability ?? 0
      current.count += 1
      horseProbabilities.set(horse.horse_id, current)
    }
  }
  const allHorses = [...horseProbabilities.values()]
    .map(({ horse, win, top3, count }) => ({
      ...horse,
      win_probability: win / count,
      top3_probability: top3 / count,
      confidence: win / count,
    }))
    .sort((left, right) => (right.win_probability ?? 0) - (left.win_probability ?? 0) || left.horse_name.localeCompare(right.horse_name))
    .map((horse, index) => ({ ...horse, predicted_position: index + 1 }))
  return { ...components[0], podium: allHorses.slice(0, 3), all_horses: allHorses }
}

interface Stats {
  n: number
  winner: number
  top3: number
  trifecta: number
  brier: number
  logLoss: number
}

function emptyStats(): Stats {
  return { n: 0, winner: 0, top3: 0, trifecta: 0, brier: 0, logLoss: 0 }
}

function accumulate(stats: Stats, outcome: NonNullable<ReturnType<typeof evaluatePrediction>>) {
  stats.n += 1
  stats.winner += Number(outcome.correctWinner)
  stats.top3 += Number(outcome.winnerTop3)
  stats.trifecta += Number(outcome.orderedTrifecta)
  stats.brier += outcome.winnerBrierScore
  stats.logLoss += outcome.winnerLogLoss
}

function summarize(stats: Stats) {
  return {
    n: stats.n,
    winnerAcc: stats.n ? stats.winner / stats.n : 0,
    top3Acc: stats.n ? stats.top3 / stats.n : 0,
    trifectaAcc: stats.n ? stats.trifecta / stats.n : 0,
    brier: stats.n ? stats.brier / stats.n : 0,
    logLoss: stats.n ? stats.logLoss / stats.n : 0,
  }
}

async function main() {
  const races: Array<{ id: string }> = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('races').select('id').eq('status', 'completed').range(offset, offset + 999)
    if (error) throw error
    races.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  const raceIds = races.map((race) => race.id)
  console.log(`Loaded ${raceIds.length} completed races`)

  const predictionsByRace = new Map<string, Map<string, PredictionPayload>>()
  const entriesByRace = new Map<string, ActualRaceEntry[]>()

  const CHUNK = 100
  for (let offset = 0; offset < raceIds.length; offset += CHUNK) {
    const chunk = raceIds.slice(offset, offset + CHUNK)
    const [predictionResult, entryResult] = await Promise.all([
      supabase.from('predictions').select('race_id, model_version, predictions').in('race_id', chunk),
      supabase.from('race_entries').select('race_id, horse_id, finishing_position, finishing_time').in('race_id', chunk),
    ])
    if (predictionResult.error) throw predictionResult.error
    if (entryResult.error) throw entryResult.error
    for (const row of (predictionResult.data ?? []) as Array<{ race_id: string; model_version: string; predictions: PredictionPayload }>) {
      const map = predictionsByRace.get(row.race_id) ?? new Map()
      map.set(row.model_version, row.predictions)
      predictionsByRace.set(row.race_id, map)
    }
    for (const row of (entryResult.data ?? []) as Array<ActualRaceEntry & { race_id: string }>) {
      const list = entriesByRace.get(row.race_id) ?? []
      list.push(row)
      entriesByRace.set(row.race_id, list)
    }
  }

  const simulated4Model = emptyStats()
  const actual2Model = emptyStats()
  let comparableRaces = 0

  for (const raceId of raceIds) {
    const versions = predictionsByRace.get(raceId)
    const entries = entriesByRace.get(raceId)
    if (!versions || !entries?.length) continue

    const base4 = BASE_VERSIONS.map((version) => versions.get(`${version}-retrospective`)).filter(Boolean) as PredictionPayload[]
    const ensemble2 = versions.get('v4.1-ensemble-retrospective')
    // Only compare races where both variants can be scored, for a like-for-like comparison.
    if (base4.length !== 4 || !ensemble2) continue

    const outcome4 = evaluatePrediction(combineEnsemble(base4), {}, entries)
    const outcome2 = evaluatePrediction(ensemble2, {}, entries)
    if (!outcome4 || !outcome2) continue

    comparableRaces += 1
    accumulate(simulated4Model, outcome4)
    accumulate(actual2Model, outcome2)
  }

  console.log(`Comparable races (both variants scoreable): ${comparableRaces}`)
  console.log('Simulated 4-model ensemble (baseline+context-form+connections+optimized):', JSON.stringify(summarize(simulated4Model), null, 2))
  console.log('Actual production ensemble (optimized+connections only):', JSON.stringify(summarize(actual2Model), null, 2))
}

main().catch((error) => {
  console.error('Experiment failed:', error)
  process.exit(1)
})
