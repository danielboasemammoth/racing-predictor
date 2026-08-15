import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { evaluatePrediction } from '../src/lib/backtest'
import { predictContextualRace, type HistoricalStart } from '../src/lib/prediction-v3'
import { predictConsensusRace } from '../src/lib/prediction-consensus'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY')
  console.error('Loaded URL:', url)
  console.error('Loaded KEY:', key)
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function loadCompletedRaces(limit = 200) {
  const { data: races, error } = await supabase
    .from('races')
    .select('id, race_datetime, distance_m, track_condition, race_class, racecourse_id')
    .eq('status', 'completed')
    .order('race_datetime', { ascending: false })
    .limit(limit)

  if (error) throw error
  return races ?? []
}

async function loadEntriesForRaces(raceIds: string[]) {
  const { data: entries, error } = await supabase
    .from('race_entries')
    .select('race_id, horse_id, finishing_position, finishing_time, margin, barrier_number, weight_carried, jockey, trainer, status, horses(*)')
    .in('race_id', raceIds)

  if (error) throw error
  return entries ?? []
}

async function loadHistoryForHorses(horseIds: string[]) {
  const pageSize = 1000
  const chunkSize = 40
  const rows: any[] = []

  for (let offset = 0; offset < horseIds.length; offset += chunkSize) {
    const horseIdsChunk = horseIds.slice(offset, offset + chunkSize)
    for (let page = 0; ; page += pageSize) {
      const { data, error } = await supabase
        .from('race_entries')
        .select(`
          race_id, horse_id, finishing_position, finishing_time, margin,
          barrier_number, weight_carried, jockey, trainer, status,
          races!inner(
            id, racecourse_id, race_datetime, distance_m, track_condition, race_class, status,
            field:race_entries(count)
          )
        `)
        .eq('races.status', 'completed')
        .neq('status', 'scratched')
        .in('horse_id', horseIdsChunk)
        .range(page, page + pageSize - 1)

      if (error) throw error
      rows.push(...(data ?? []))
      if (!data || data.length < pageSize) break
    }
  }

  return rows.map((row) => ({
    raceId: row.race_id,
    horseId: row.horse_id,
    racecourseId: row.races.racecourse_id,
    raceDatetime: row.races.race_datetime,
    distanceM: row.races.distance_m ?? undefined,
    trackCondition: row.races.track_condition ?? undefined,
    raceClass: row.races.race_class ?? undefined,
    finishingPosition: row.finishing_position ?? undefined,
    fieldSize: row.races.field[0]?.count ?? 0,
    finishingTime: row.finishing_time ?? undefined,
    margin: row.margin ?? undefined,
    barrier: row.barrier_number ?? undefined,
    weight: row.weight_carried ?? undefined,
    jockey: row.jockey ?? undefined,
    trainer: row.trainer ?? undefined,
  })) as HistoricalStart[]
}

function runModel(model: 'contextual' | 'consensus', entries: any[], race: any, history: HistoricalStart[]) {
  const typedEntries = entries
    .filter((e: any) => e.status !== 'scratched')
    .map((e: any) => ({
      ...e,
      horses: e.horses ?? null,
    })) as any[]

  if (model === 'consensus') {
    return predictConsensusRace({
      race: {
        id: race.id,
        racecourseId: race.racecourse_id,
        raceDatetime: race.race_datetime,
        distanceM: race.distance_m ?? undefined,
        trackCondition: race.track_condition ?? undefined,
        raceClass: race.race_class ?? undefined,
      },
      entries: typedEntries,
      history,
      fieldSize: typedEntries.length,
    })
  }

  return predictContextualRace({
    race: {
      id: race.id,
      racecourseId: race.racecourse_id,
      raceDatetime: race.race_datetime,
      distanceM: race.distance_m ?? undefined,
      trackCondition: race.track_condition ?? undefined,
      raceClass: race.race_class ?? undefined,
    },
    entries: typedEntries,
    history,
    fieldSize: typedEntries.length,
  })
}

async function compareModels() {
  const races = await loadCompletedRaces(200)
  const entries = await loadEntriesForRaces(races.map((r) => r.id))
  const horseIds = [...new Set(entries.map((e) => e.horse_id))]
  const history = await loadHistoryForHorses(horseIds)

  const entriesByRace = new Map<string, any[]>()
  for (const entry of entries) {
    const existing = entriesByRace.get(entry.race_id) ?? []
    existing.push(entry)
    entriesByRace.set(entry.race_id, existing)
  }

  const models: Array<{ name: string; key: 'contextual' | 'consensus'; outcomes: any[] }> = [
    { name: 'v3.1 contextual', key: 'contextual', outcomes: [] },
    { name: 'v3.2 consensus', key: 'consensus', outcomes: [] },
  ]

  for (const race of races) {
    const raceEntries = entriesByRace.get(race.id) ?? []
    if (!raceEntries.length) continue

    for (const model of models) {
      const result = runModel(model.key, raceEntries, race, history)
      const outcome = evaluatePrediction(
        result.predictions,
        result.predicted_times,
        raceEntries.map((e) => ({
          horse_id: e.horse_id,
          finishing_position: e.finishing_position,
          finishing_time: e.finishing_time,
        })),
      )

      if (!outcome) continue
      model.outcomes.push({
        raceId: race.id,
        ...outcome,
        confidence: result.confidence_scores.winner,
      })
    }
  }

  console.log('\n=== Model Backtest Comparison ===\n')
  for (const model of models) {
    const total = model.outcomes.length
    if (!total) continue
    const winners = model.outcomes.filter((o) => o.correctWinner).length
    const podiums = model.outcomes.filter((o) => o.correctPodium).length
    const avgConf = model.outcomes.reduce((sum, o) => sum + (o.confidence ?? 0), 0) / total
    const timeErrors = model.outcomes.flatMap((o) => o.timeErrors ?? [])
    const avgTimeError = timeErrors.length ? timeErrors.reduce((sum, e) => sum + e, 0) / timeErrors.length : 0

    console.log(`${model.name}`)
    console.log(`  Races: ${total}`)
    console.log(`  Winner accuracy: ${((winners / total) * 100).toFixed(1)}%`)
    console.log(`  Podium accuracy: ${((podiums / total) * 100).toFixed(1)}%`)
    console.log(`  Avg confidence: ${(avgConf * 100).toFixed(1)}%`)
    console.log(`  Avg time error: ${avgTimeError.toFixed(2)}s`)
    console.log()
  }
}

compareModels().catch((error) => {
  console.error('Comparator failed', error)
  process.exit(1)
})
