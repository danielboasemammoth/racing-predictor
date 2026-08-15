import { NextResponse } from 'next/server'
import { MODEL_VERSION, predictRace } from '@/lib/prediction'
import { createAdminClient } from '@/lib/supabase/admin'
import type { RaceEntryWithHorse } from '@/lib/types'
import { hasAdminSession } from '@/lib/admin-auth'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function readRaceId(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) return undefined

  const body: unknown = await request.json()
  if (typeof body !== 'object' || body === null || !('raceId' in body)) return undefined
  return typeof body.raceId === 'string' ? body.raceId : null
}

export async function POST(request: Request) {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const raceId = await readRaceId(request)
    if (raceId === null || (raceId !== undefined && !UUID_PATTERN.test(raceId))) {
      return NextResponse.json({ success: false, message: 'raceId must be a valid UUID' }, { status: 400 })
    }

    const supabase = createAdminClient()
    let raceQuery = supabase.from('races').select('id, track_condition').eq('status', 'upcoming')
    raceQuery = raceId ? raceQuery.eq('id', raceId) : raceQuery.limit(20)

    const { data: races, error: racesError } = await raceQuery
    if (racesError) throw racesError
    if (!races?.length) {
      return NextResponse.json({ success: false, message: 'No upcoming races to predict' }, { status: 404 })
    }

    let created = 0
    let skipped = 0

    for (const race of races) {
      const { data: entries, error: entriesError } = await supabase
        .from('race_entries')
        .select('*, horses(*)')
        .eq('race_id', race.id)

      if (entriesError) throw entriesError
      const typedEntries = (entries ?? []) as RaceEntryWithHorse[]
      if (!typedEntries.some((entry) => entry.horses)) {
        skipped += 1
        continue
      }

      const result = predictRace(typedEntries, race.track_condition ?? undefined)
      const { error: predictionError } = await supabase.from('predictions').upsert({
        race_id: race.id,
        model_version: MODEL_VERSION,
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
      modelVersion: MODEL_VERSION,
      message: `Generated predictions for ${created} races`,
    })
  } catch (error) {
    console.error('Prediction run failed', error)
    return NextResponse.json({ success: false, message: 'Prediction run failed' }, { status: 500 })
  }
}
