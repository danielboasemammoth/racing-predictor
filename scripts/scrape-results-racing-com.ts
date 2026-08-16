import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const VICTORIA_RACECOURSES = [
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

function isVictoriaRacecourse(name: string): boolean {
  const value = name.trim().toLowerCase()
  return VICTORIA_RACECOURSES.some((course) => value.includes(course.toLowerCase()))
}

async function scrapeResultsRacingCom() {
  console.log('Fetching recent race results from Racing.com...')

  try {
    const yesterday = new Date(Date.now() - 86400000)
    const dateStr = yesterday.toISOString().split('T')[0]

    const response = await fetch(`https://www.racing.com/races/${dateStr}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
    })

    if (!response.ok) {
      console.error(`Racing.com responded with ${response.status}`)
      return
    }

    const html = await response.text()
    console.log(`Fetched ${html.length} chars`)

    const results = extractResults(html)
    console.log(`Found ${results.length} result entries`)

    const victoriaResults = results.filter((r) => isVictoriaRacecourse(r.racecourse))
    console.log(`Victoria results: ${victoriaResults.length}`)

    let updated = 0
    for (const result of victoriaResults) {
      const racecourseId = await findOrCreateRacecourse(result.racecourse)
      const { data: race } = await supabase
        .from('races')
        .select('id')
        .eq('racecourse_id', racecourseId)
        .eq('race_datetime', result.race_datetime)
        .single()

      if (!race) {
        console.log(`Race not found: ${result.racecourse} ${result.race_datetime}, creating...`)
        const { data: newRace } = await supabase
          .from('races')
          .insert({
            racecourse_id: racecourseId,
            race_datetime: result.race_datetime,
            distance_m: result.distanceM,
            track_condition: result.track_condition,
            race_class: result.race_class,
            status: 'completed',
          })
          .select('id')
          .single()

        if (!newRace) continue
        await updateRaceEntries(newRace.id, result)
        updated += 1
      } else {
        await updateRaceEntries(race.id, result)
        updated += 1
      }
    }

    console.log(`Updated ${updated} races`)
  } catch (error) {
    console.error('Results scrape failed:', error)
  }
}

async function updateRaceEntries(raceId: string, result: any) {
  if (!result.entries?.length) return

  for (const entry of result.entries) {
    const horseId = await findOrCreateHorse(entry.horse_name)
    const { error } = await supabase.from('race_entries').upsert(
      {
        race_id: raceId,
        horse_id: horseId,
        finishing_position: entry.finishing_position,
        finishing_time: entry.finishing_time,
        margin: entry.margin,
        barrier_number: entry.barrier_number,
        weight_carried: entry.weight_carried,
        jockey: entry.jockey,
        trainer: entry.trainer,
        status: 'finished',
      },
      { onConflict: 'race_id,horse_id' },
    )

    if (error) {
      console.error(`Failed to upsert entry ${entry.horse_name}:`, error)
    }
  }
}

function extractResults(html: string) {
  const results = []
  const racecourseRegex = /<h2[^>]*>([^<]+)<\/h2>/gi
  const timeRegex = /<time[^>]*datetime="([^"]+)"[^>]*>/gi
  const horseNameRegex = /<span[^>]*class="horse-name[^"]*"[^>]*>([^<]+)<\/span>/gi
  const positionRegex = /<span[^>]*class="position[^"]*"[^>]*>(\d+)<\/span>/gi
  const timeRegex2 = /<span[^>]*class="time[^"]*"[^>]*>([\d:.]+)<\/span>/gi

  let match
  while ((match = racecourseRegex.exec(html)) !== null) {
    const racecourse = match[1].trim()
    if (!isVictoriaRacecourse(racecourse)) continue

    const startIndex = match.index
    const nextRacecourse = html.indexOf('<h2', startIndex + 1)
    const block = html.slice(startIndex, nextRacecourse === -1 ? html.length : nextRacecourse)

    const timeMatch = block.match(timeRegex)
    const raceDatetime = timeMatch ? timeMatch[1] : new Date().toISOString()

    const horseNames = Array.from(block.matchAll(horseNameRegex)).map((m) => m[1].trim())
    const positions = Array.from(block.matchAll(positionRegex)).map((m) => Number(m[1]))
    const times = Array.from(block.matchAll(timeRegex2)).map((m) => m[1].trim())

    const entries = horseNames.map((horseName, i) => ({
      horse_name: horseName,
      finishing_position: positions[i] || i + 1,
      finishing_time: times[i] ? parseTime(times[i]) : undefined,
      margin: i === 0 ? 0 : positions[i] ? positions[i] * 0.15 : undefined,
      barrier_number: undefined,
      weight_carried: undefined,
      jockey: undefined,
      trainer: undefined,
    }))

    results.push({
      racecourse,
      race_datetime: raceDatetime,
      distanceM: null,
      track_condition: null,
      race_class: null,
      entries,
    })
  }

  return results
}

function parseTime(timeStr: string): number | undefined {
  const parts = timeStr.split(':').map(Number)
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]
  }
  if (parts.length === 3) {
    return parts[0] * 60 + parts[1] + parts[2] / 100
  }
  return undefined
}

async function findOrCreateRacecourse(name: string): Promise<string> {
  const { data: existing } = await supabase
    .from('racecourses')
    .select('id')
    .ilike('name', `%${name}%`)
    .limit(1)

  if (existing?.length) return existing[0].id

  const { data: created } = await supabase
    .from('racecourses')
    .insert({ name })
    .select('id')
    .single()

  return created?.id
}

async function findOrCreateHorse(name: string): Promise<string> {
  const { data: existing } = await supabase
    .from('horses')
    .select('id')
    .ilike('name', name)
    .limit(1)

  if (existing?.length) return existing[0].id

  const { data: created } = await supabase
    .from('horses')
    .insert({ name })
    .select('id')
    .single()

  return created?.id
}

scrapeResultsRacingCom().catch((error) => {
  console.error('Results scraper failed', error)
  process.exit(1)
})
