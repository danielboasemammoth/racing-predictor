import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import {
  inferColumns,
  isValidHorseName,
  missingRequiredColumns,
  normaliseRacecourse,
  optionalNumber,
  optionalValue,
  parseCsv,
} from '@/lib/csv-import'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

interface RaceRow {
  racecourse: string
  race_datetime: string
  distance_m?: number
  track_condition?: string
  race_class?: string
  status?: string
  race_number?: number
}

interface EntryRow {
  racecourse: string
  race_datetime: string
  horse_name: string
  finishing_position?: number
  finishing_time?: number
  margin?: number
  barrier_number?: number
  weight_carried?: number
  jockey?: string
  trainer?: string
  status?: string
}

function raceStatus(value?: string) {
  return ['upcoming', 'live', 'completed', 'cancelled'].includes(value ?? '') ? value : 'completed'
}

function entryStatus(value: string | undefined, finishingPosition?: number) {
  if (['running', 'finished', 'scratched', 'did_not_finish'].includes(value ?? '')) return value
  return finishingPosition !== undefined ? 'finished' : 'running'
}

async function findOrCreateRacecourse(name: string): Promise<string> {
  const supabase = createAdminClient()
  const normalised = normaliseRacecourse(name)
  if (!normalised) {
    throw new Error(`Non-Victoria racecourse: ${name}`)
  }

  const { data: existing, error: existingError } = await supabase
    .from('racecourses')
    .select('id, name')
    .ilike('name', `%${normalised}%`)
    .limit(1)

  if (existingError) throw existingError
  if (existing?.length) {
    return existing[0].id
  }

  const { data: created, error: createError } = await supabase
    .from('racecourses')
    .insert({ name: normalised, state: 'VIC', region: 'Victoria' })
    .select('id')
    .single()

  if (createError) throw createError
  return created.id
}

async function findOrCreateHorse(name: string): Promise<string> {
  const supabase = createAdminClient()
  const { data: existing, error: existingError } = await supabase
    .from('horses')
    .select('id')
    .ilike('name', name)
    .limit(1)

  if (existingError) throw existingError
  if (existing?.length) {
    return existing[0].id
  }

  const { data: created, error: createError } = await supabase
    .from('horses')
    .insert({ name })
    .select('id')
    .single()

  if (createError) throw createError
  return created.id
}

export async function POST(request: Request) {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
    const body = await request.json().catch(() => ({}))
    const csv = typeof body.csv === 'string' ? body.csv : null
    const dryRun = Boolean(body.dryRun)

    if (!csv) {
      return NextResponse.json({ success: false, message: 'Missing CSV payload' }, { status: 400 })
    }
    if (csv.length > 1_000_000) {
      return NextResponse.json({ success: false, message: 'CSV exceeds the 1 MB limit' }, { status: 413 })
    }

    let rows: string[][]
    try {
      rows = parseCsv(csv)
    } catch (error) {
      return NextResponse.json({
        success: false,
        message: error instanceof Error ? error.message : 'Malformed CSV',
      }, { status: 400 })
    }
    if (!rows.length) {
      return NextResponse.json({ success: false, message: 'Empty CSV' }, { status: 400 })
    }

    const headers = rows[0]
    const idx = inferColumns(headers)
    const missingColumns = missingRequiredColumns(idx)
    if (missingColumns.length) {
      return NextResponse.json({
        success: false,
        message: `Missing required columns: ${missingColumns.join(', ')}`,
      }, { status: 400 })
    }

    const dataRows = rows.slice(1)
    if (!dataRows.length) {
      return NextResponse.json({ success: false, message: 'No data rows found' }, { status: 400 })
    }

    const racesMap = new Map<string, { race: RaceRow; entries: EntryRow[] }>()

    for (const row of dataRows) {
      const racecourse = optionalValue(row, idx.racecourse) ?? ''
      const raceDatetime = optionalValue(row, idx.race_datetime) ?? ''
      if (!normaliseRacecourse(racecourse) || !Number.isFinite(Date.parse(raceDatetime))) continue

      const key = `${racecourse.trim()}|${raceDatetime.trim()}`
      const existing = racesMap.get(key) ?? {
        race: {
          racecourse: racecourse.trim(),
          race_datetime: raceDatetime.trim(),
          race_number: optionalNumber(row, idx.race_number) ?? 1,
          distance_m: optionalNumber(row, idx.distance_m),
          track_condition: optionalValue(row, idx.track_condition),
          race_class: optionalValue(row, idx.race_class),
          status: raceStatus(optionalValue(row, idx.status)),
        },
        entries: [],
      }

      const horseName = optionalValue(row, idx.horse_name)
      if (horseName && isValidHorseName(horseName)) {
        const finishingPosition = optionalNumber(row, idx.finishing_position)
        existing.entries.push({
          racecourse: racecourse.trim(),
          race_datetime: raceDatetime.trim(),
          horse_name: horseName,
          finishing_position: finishingPosition,
          finishing_time: optionalNumber(row, idx.finishing_time),
          margin: optionalNumber(row, idx.margin),
          barrier_number: optionalNumber(row, idx.barrier_number),
          weight_carried: optionalNumber(row, idx.weight_carried),
          jockey: optionalValue(row, idx.jockey),
          trainer: optionalValue(row, idx.trainer),
          status: entryStatus(optionalValue(row, idx.status), finishingPosition),
        })
      }

      racesMap.set(key, existing)
    }

    if (!racesMap.size) {
      return NextResponse.json({ success: false, message: 'No valid race rows found. Check CSV headers.' }, { status: 400 })
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        summary: {
          races: racesMap.size,
          entries: [...racesMap.values()].reduce((sum, group) => sum + group.entries.length, 0),
          sample: [...racesMap.values()].slice(0, 3).map((group) => ({
            racecourse: group.race.racecourse,
            race_datetime: group.race.race_datetime,
            entries: group.entries.length,
          })),
        },
      })
    }

    let racesCreated = 0
    let entriesCreated = 0
    const errors: string[] = []

    for (const group of racesMap.values()) {
      try {
        const racecourseId = await findOrCreateRacecourse(group.race.racecourse)

        const { data: existingRace, error: existingRaceError } = await supabase
          .from('races')
          .select('id')
          .eq('racecourse_id', racecourseId)
          .eq('race_datetime', group.race.race_datetime)
          .limit(1)

        if (existingRaceError) throw existingRaceError
        let raceId: string

        if (existingRace?.length) {
          raceId = existingRace[0].id
        } else {
          const { data: createdRace, error: createRaceError } = await supabase
            .from('races')
            .insert({
              racecourse_id: racecourseId,
              race_number: group.race.race_number ?? 1,
              race_datetime: group.race.race_datetime,
              distance_m: group.race.distance_m,
              track_condition: group.race.track_condition,
              race_class: group.race.race_class,
              status: group.race.status,
            })
            .select('id')
            .single()

          if (createRaceError) throw createRaceError
          raceId = createdRace.id
          racesCreated += 1
        }

        const horseIds = await Promise.all([...new Set(group.entries.map((e) => e.horse_name))].map((name) => findOrCreateHorse(name)))

        const horseNameToId = new Map<string, string>()
        for (let i = 0; i < horseIds.length; i++) {
          horseNameToId.set([...new Set(group.entries.map((e) => e.horse_name))][i], horseIds[i])
        }

        const rowsToInsert = group.entries.map((entry) => ({
          race_id: raceId,
          horse_id: horseNameToId.get(entry.horse_name)!,
          finishing_position: entry.finishing_position,
          finishing_time: entry.finishing_time,
          margin: entry.margin,
          barrier_number: entry.barrier_number,
          weight_carried: entry.weight_carried,
          jockey: entry.jockey,
          trainer: entry.trainer,
          status: entry.status,
        }))

        const { error: insertError } = await supabase.from('race_entries').upsert(rowsToInsert, {
          onConflict: 'race_id,horse_id',
        })

        if (insertError) throw insertError
        entriesCreated += rowsToInsert.length
      } catch (error) {
        errors.push(`${group.race.racecourse} ${group.race.race_datetime}: ${error instanceof Error ? error.message : 'Unknown'}`)
      }
    }

    return NextResponse.json({
      success: true,
      dryRun: false,
      summary: {
        races: racesMap.size,
        racesCreated,
        entriesCreated,
        errors,
      },
    })
  } catch (error) {
    console.error('CSV import failed', error)
    return NextResponse.json({ success: false, message: 'Import failed' }, { status: 500 })
  }
}
