import { NextResponse } from 'next/server'
import type { HistoricalStart } from '@/lib/prediction-v3'
import { ALL_MODEL_CONFIGS, runConfiguredModel, runEnsemble } from '@/lib/prediction-suite'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseStandardTimeDifference } from '@/lib/sectional-speed'
import type { RaceEntryWithHorse } from '@/lib/types'
import { hasAdminSession } from '@/lib/admin-auth'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Retries a Supabase call a couple of times so a single transient network blip doesn't fail a long-running batch. */
async function withRetry<T>(fn: () => PromiseLike<T>, attempts = 3, delayMs = 1000): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
    }
  }
  throw lastError
}

interface PredictionOptions {
  raceId?: string
  mode?: 'all' | 'ensemble' | 'retrospective'
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
  speed_ratings: { standard_time_difference?: string | null } | null
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
  if (mode !== undefined && !['all', 'ensemble', 'retrospective'].includes(mode as string)) return null

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
    const runFullSuite = options.mode === 'all' || options.mode === 'retrospective'

    const supabase = createAdminClient()
    const raceSelect = 'id, racecourse_id, race_datetime, distance_m, track_condition, race_class'
    let races: Array<{ id: string; racecourse_id: string; race_datetime: string; distance_m: number | null; track_condition: string | null; race_class: string | null }>
    if (options.raceId) {
      const { data, error } = await supabase.from('races').select(raceSelect).eq('status', status).eq('id', options.raceId)
      if (error) throw error
      races = data ?? []
    } else if (status === 'upcoming') {
      const { data, error } = await supabase.from('races').select(raceSelect).eq('status', status).order('race_datetime', { ascending: true }).limit(50)
      if (error) throw error
      races = data ?? []
    } else {
      // Retrospective backfills cover every completed race - Supabase caps an unpaginated
      // select at 1000 rows, which silently truncated this to only the most recent races.
      races = []
      const pageSize = 1_000
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase.from('races').select(raceSelect).eq('status', status).order('race_datetime', { ascending: false }).range(offset, offset + pageSize - 1)
        if (error) throw error
        races.push(...(data ?? []))
        if (!data || data.length < pageSize) break
      }
    }

    if (!races?.length) {
      return NextResponse.json({ success: false, message: `No ${status} races to predict` }, { status: 404 })
    }

    const targetEntryRows: RaceEntryWithHorse[] = []
    const raceChunkSize = 40
    for (let offset = 0; offset < races.length; offset += raceChunkSize) {
      const { data: entryPage, error: targetEntriesError } = await supabase
        .from('race_entries')
        .select('*, horses(*)')
        .in('race_id', races.slice(offset, offset + raceChunkSize).map((race) => race.id))
      if (targetEntriesError) throw targetEntriesError
      targetEntryRows.push(...((entryPage ?? []) as RaceEntryWithHorse[]))
    }
    const entriesByRace = Map.groupBy(
      targetEntryRows,
      (entry) => entry.race_id,
    )
    const targetHorseIds = [...new Set(targetEntryRows.map((entry) => entry.horse_id))]

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
            barrier_number, weight_carried, jockey, trainer, status, speed_ratings,
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
      standardTimeDifference: parseStandardTimeDifference(row.speed_ratings?.standard_time_difference) ?? undefined,
    }))

    let created = 0
    let skipped = 0
    const allRows: Array<{ race_id: string; model_version: string; predictions: unknown; confidence_scores: unknown; predicted_times: unknown; predicted_at: string }> = []
    const predictedRaceIds: string[] = []
    const suffix = options.mode === 'retrospective' ? '-retrospective' : ''

    for (const race of races) {
      const typedEntries = (entriesByRace.get(race.id) ?? [])
        .filter((entry) => entry.status !== 'scratched')
      if (!typedEntries.some((entry) => entry.horses)) {
        skipped += 1
        continue
      }

      const oddsByHorse = Object.fromEntries(typedEntries.map((entry) => [entry.horse_id, bestOdds(entry)]))

      const input = {
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
        fieldSize: typedEntries.length,
      }
      const results = runFullSuite
        ? [...ALL_MODEL_CONFIGS.map((config) => runConfiguredModel(input, config)), runEnsemble(input)]
        : [runEnsemble(input)]
      allRows.push(...results.map((result) => ({
          race_id: race.id,
          model_version: `${result.modelVersion}${suffix}`,
          predictions: result.predictions,
          confidence_scores: result.confidence_scores,
          predicted_times: result.predicted_times,
          predicted_at: new Date().toISOString(),
        })))
      predictedRaceIds.push(race.id)
      created += 1
    }

    // Batching (instead of one delete+insert round trip per race) turns what was ~2 x N
    // sequential Supabase calls into a handful, which is both far faster and far less exposed
    // to a single transient network blip killing the whole run partway through.
    const modelVersionsWritten = [...new Set(allRows.map((row) => row.model_version))]
    if (options.mode === 'retrospective') {
      // A completed race's history never changes day-to-day, so retrospective reruns replace
      // the prior rows instead of growing unbounded duplicate history.
      for (let offset = 0; offset < predictedRaceIds.length; offset += 40) {
        const { error: deleteError } = await withRetry(() => supabase
          .from('predictions')
          .delete()
          .in('race_id', predictedRaceIds.slice(offset, offset + 40))
          .in('model_version', modelVersionsWritten))
        if (deleteError) throw deleteError
      }
    }
    // Live/upcoming predictions are inserted as a new immutable snapshot every run, so
    // prediction and market movement can be analysed over time (never overwritten).
    for (let offset = 0; offset < allRows.length; offset += 500) {
      const { error: predictionError } = await withRetry(() => supabase
        .from('predictions')
        .insert(allRows.slice(offset, offset + 500)))
      if (predictionError) throw predictionError
    }

    return NextResponse.json({
      success: true,
      created,
      skipped,
      modelVersion: runFullSuite ? 'v4-model-suite' : 'v4.1-ensemble',
      message: `Generated ${runFullSuite ? 'all model variants' : 'ensemble predictions'} for ${created} races`,
    })
  } catch (error) {
    console.error('Prediction run failed', error)
    return NextResponse.json({ success: false, message: 'Prediction run failed' }, { status: 500 })
  }
}
