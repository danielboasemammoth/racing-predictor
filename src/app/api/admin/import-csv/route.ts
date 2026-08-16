import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

interface RaceRow {
  racecourse: string
  race_datetime: string
  distance_m?: number
  track_condition?: string
  race_class?: string
  status?: string
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

function normaliseRacecourse(name: string): string | null {
  const value = name.trim()
  const victoriaCourses = [
    'Flemington',
    'Caulfield',
    'Moonee Valley',
    'Sandown',
    'Ballarat',
    'Bendigo',
    'Geelong',
    'Mornington',
    'Sale',
    'Cranbourne',
    'Pakenham',
    'Melton',
    'Healesville',
    'Traralgon',
    'Moe',
    'Wodonga',
    'Shepparton',
    'Mildura',
    'Wangaratta',
    'Ararat',
    'Echuca',
    'Swan Hill',
    'Horsham',
    'Casterton',
    'Portland',
  ]
  // @ts-ignore
  return victoriaCourses.find((course) => value.toLowerCase().includes(course.toLowerCase())) ?? null
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
    .insert({ name: normalised })
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

function parseCsv(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/)
  const rows: string[][] = []
  let current: string[] = []
  let currentField = ''
  let inQuotes = false

  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          currentField += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        current.push(currentField.trim())
        currentField = ''
      } else {
        currentField += char
      }
    }
    current.push(currentField.trim())
    currentField = ''
    if (!inQuotes) {
      rows.push(current)
      current = []
    }
  }

  if (currentField || current.length) {
    rows.push(current)
  }

  return rows
}

function inferColumns(headers: string[]): { race: RaceRow; entries: EntryRow[]; idx: Record<string, number> } {
  const lower = headers.map((h) => h.toLowerCase())
  const race: RaceRow = { racecourse: '', race_datetime: '', status: 'completed' }
  const entries: EntryRow[] = []

  const idx = {
    racecourse: lower.indexOf('racecourse'),
    race_datetime: lower.indexOf('race_datetime') !== -1 ? lower.indexOf('race_datetime') : lower.indexOf('date'),
    distance_m: lower.indexOf('distance_m') !== -1 ? lower.indexOf('distance_m') : lower.indexOf('distance'),
    track_condition: lower.indexOf('track_condition') !== -1 ? lower.indexOf('track_condition') : lower.indexOf('condition'),
    race_class: lower.indexOf('race_class') !== -1 ? lower.indexOf('race_class') : lower.indexOf('class'),
    horse_name: lower.indexOf('horse_name') !== -1 ? lower.indexOf('horse_name') : lower.indexOf('horse'),
    finishing_position: lower.indexOf('finishing_position') !== -1 ? lower.indexOf('finishing_position') : lower.indexOf('position'),
    finishing_time: lower.indexOf('finishing_time') !== -1 ? lower.indexOf('finishing_time') : lower.indexOf('time'),
    margin: lower.indexOf('margin'),
    barrier_number: lower.indexOf('barrier_number') !== -1 ? lower.indexOf('barrier_number') : lower.indexOf('barrier'),
    weight_carried: lower.indexOf('weight_carried') !== -1 ? lower.indexOf('weight_carried') : lower.indexOf('weight'),
    jockey: lower.indexOf('jockey'),
    trainer: lower.indexOf('trainer'),
    status: lower.indexOf('status'),
  }

  return { race, entries, idx }
}

export async function POST(request: Request) {
  const supabase = createAdminClient()

  try {
    const body = await request.json().catch(() => ({}))
    const csv = typeof body.csv === 'string' ? body.csv : null
    const dryRun = Boolean(body.dryRun)

    if (!csv) {
      return NextResponse.json({ success: false, message: 'Missing CSV payload' }, { status: 400 })
    }

    const rows = parseCsv(csv)
    if (!rows.length) {
      return NextResponse.json({ success: false, message: 'Empty CSV' }, { status: 400 })
    }

    const headers = rows[0]
    const { race, entries, idx } = inferColumns(headers)

    const dataRows = rows.slice(1)
    if (!dataRows.length) {
      return NextResponse.json({ success: false, message: 'No data rows found' }, { status: 400 })
    }

    const racesMap = new Map<string, { race: RaceRow; entries: EntryRow[] }>()

    for (const row of dataRows) {
      const racecourse = row[idx.racecourse] ?? ''
      const raceDatetime = row[idx.race_datetime] ?? ''
      if (!racecourse || !raceDatetime) continue

      const key = `${racecourse.trim()}|${raceDatetime.trim()}`
      const existing = racesMap.get(key) ?? {
        race: {
          racecourse: racecourse.trim(),
          race_datetime: raceDatetime.trim(),
          distance_m: row[idx.distance_m] ? Number(row[idx.distance_m]) : undefined,
          track_condition: row[idx.track_condition]?.trim() ?? undefined,
          race_class: row[idx.race_class]?.trim() ?? undefined,
          status: row[idx.status]?.trim() || 'completed',
        },
        entries: [],
      }

      const horseName = row[idx.horse_name]?.trim()
      if (horseName) {
        existing.entries.push({
          racecourse: racecourse.trim(),
          race_datetime: raceDatetime.trim(),
          horse_name: horseName,
          finishing_position: row[idx.finishing_position] ? Number(row[idx.finishing_position]) : undefined,
          finishing_time: row[idx.finishing_time] ? Number(row[idx.finishing_time]) : undefined,
          margin: row[idx.margin] ? Number(row[idx.margin]) : undefined,
          barrier_number: row[idx.barrier_number] ? Number(row[idx.barrier_number]) : undefined,
          weight_carried: row[idx.weight_carried] ? Number(row[idx.weight_carried]) : undefined,
          jockey: row[idx.jockey]?.trim() ?? undefined,
          trainer: row[idx.trainer]?.trim() ?? undefined,
          status: row[idx.status]?.trim() || 'finished',
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
