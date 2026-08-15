import { NextResponse } from 'next/server'
import {
  CONTEXTUAL_MODEL_VERSION,
  predictContextualRace,
  type HistoricalStart,
} from '@/lib/prediction-v3'
import { predictConsensusRace } from '@/lib/prediction-consensus'
import { createAdminClient } from '@/lib/supabase/admin'
import type { RaceEntryWithHorse } from '@/lib/types'
import { hasAdminSession } from '@/lib/admin-auth'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface PredictionOptions {
  raceId?: string
  mode?: 'retrospective' | 'consensus'
}

interface HistoricalEntryRow {
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
  races: {
    id: string
    racecourse_id: string
    race_datetime: string
    distance_m: number | null
    track_condition: string | null
    race_class: string | null
    field: Array<{ count: number }>
  }
}

function bestOdds(entry: RaceEntryWithHorse) {
  const metadata = entry.sectional_times
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return {}
  const quotes = metadata.odds
  if (!Array.isArray(quotes)) return {}
  const values = quotes.filter((quote): quote is { [key: string]: string | number | boolean | null } =>
    Boolean(quote && typeof quote === 'object' && !Array.isArray(quote)),
  )
  return {
    win: Math.max(0, ...values.map((quote) => Number(quote.win) || 0)) || undefined,
    place: Math.max(0, ...values.map((quote) => Number(quote.place) || 0)) || undefined,
  }
}

async function readOptions(request: Request): Promise<PredictionOptions | null> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return {}
  }

  const body: unknown = await request.json()
  if (typeof body !== 'object' || body === null) return null

  const raceId = 'raceId' in body ? body.raceId : undefined
  const mode = 'mode' in body ? body.mode : undefined
  if (raceId !== undefined && typeof raceId !== 'string') return null
  if (mode !== undefined && !['retrospective', 'consensus'].includes(mode as string)) return null

  return {
    raceId,
    mode: mode as PredictionOptions['mode'],
  }
}

export async function POST(request: Request) {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const options = await readOptions(request)
    if (!options || (options.raceId !== undefined && !UUID_PATTERN.test(options.raceId))) {
      return NextResponse.json({ success: false, message: 'Invalid prediction options' }, { status: 400 })
    }

    const status = options.mode === 'retrospective' ? 'completed' : 'upcoming'
    const useConsensus = options.mode === 'consensus'
    const modelVersion = useConsensus
      ? 'v3.2-consensus'
      : options.mode === 'retrospective'
        ? `${CONTEXTUAL_MODEL_VERSION}-retrospective`
        : CONTEXTUAL_MODEL_VERSION

    const supabase = createAdminClient()
    let raceQuery = supabase
      .from('races')
      .select('id, racecourse_id, race_datetime, distance_m, track_condition, race_class')
      .eq('status', status)
      .order('race_datetime', { ascending: status === 'upcoming' })
    raceQuery = options.raceId ? raceQuery.eq('id', options.raceId) : raceQuery.limit(50)

    const { data: races, error: racesError } = await raceQuery
    if (racesError) throw racesError
    if (!races?.length) {
      return NextResponse.json({ success: false, message: `No ${status} races to predict` }, { status: 404 })
    }

    const { data: targetEntryRows, error: targetEntriesError } = await supabase
      .from('race_entries')
      .select('*, horses(*)')
      .in('race_id', races.map((race) => race.id))
    if (targetEntriesError) throw targetEntriesError
    const entriesByRace = Map.groupBy(
      (targetEntryRows ?? []) as RaceEntryWithHorse[],
      (entry) => entry.race_id,
    )
    const targetHorseIds = [...new Set((targetEntryRows ?? []).map((entry) => entry.horse_id))]

    const historicalRows: HistoricalEntryRow[] = []
    const pageSize = 1_000
    const horseChunkSize = 40
    for (let horseOffset = 0; horseOffset < targetHorseIds.length; horseOffset += horseChunkSize) {
      const horseIds = targetHorseIds.slice(horseOffset, horseOffset + horseChunkSize)
      for (let offset = 0; ; offset += pageSize) {
        const { data: historyPage, error: historyError } = await supabase
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
          .in('horse_id', horseIds)
          .range(offset, offset + pageSize - 1)
        if (historyError) throw historyError
        historicalRows.push(...(historyPage as unknown as HistoricalEntryRow[]))
        if (!historyPage || historyPage.length < pageSize) break
      }
    }

    const history: HistoricalStart[] = historicalRows.map((row) => ({
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
    }))

    let created = 0
    let skipped = 0

    for (const race of races) {
      const typedEntries = (entriesByRace.get(race.id) ?? [])
        .filter((entry) => entry.status !== 'scratched')
      if (!typedEntries.some((entry) => entry.horses)) {
        skipped += 1
        continue
      }

      const oddsByHorse = Object.fromEntries(typedEntries.map((entry) => [entry.horse_id, bestOdds(entry)]))

      let result
      if (useConsensus) {
        result = predictConsensusRace({
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
          oddsByHorse,
        })
      } else {
        result = predictContextualRace({
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
          oddsByHorse,
        })
      }

      const { error: predictionError } = await supabase.from('predictions').upsert({
        race_id: race.id,
        model_version: modelVersion,
        predictions: result.predictions,
        confidence_scores: result.confidence_scores,
        predicted_times: result.predicted_times,
        predicted_at: new Date().toISOString(),
      }, { onConflict: 'race_id,model_version' })

      if (predictionError) throw predictionError
      created += 1
    }

    return NextResponse.json({
      success: true,
      created,
      skipped,
      modelVersion,
      message: `Generated predictions for ${created} races`,
    })
  } catch (error) {
    console.error('Prediction run failed', error)
    return NextResponse.json({ success: false, message: 'Prediction run failed' }, { status: 500 })
  }
}
