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

async function scrapeRacingComVictoria() {
  console.log('Fetching Victoria races from Racing.com...')

  try {
    const response = await fetch('https://www.racing.com/races', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
    })

    if (!response.ok) {
      console.error(`Racing.com responded with ${response.status}`)
      return
    }

    const html = await response.text()
    console.log(`Fetched ${html.length} chars from Racing.com`)

    const raceBlocks = extractRaceBlocks(html)
    console.log(`Found ${raceBlocks.length} race blocks`)

    const victoriaRaces = raceBlocks.filter((race) => isVictoriaRacecourse(race.racecourse))
    console.log(`Victoria races: ${victoriaRaces.length}`)

    let created = 0
    for (const race of victoriaRaces) {
      const racecourseId = await findOrCreateRacecourse(race.racecourse)
      const { error } = await supabase.from('races').upsert({
        racecourse_id: racecourseId,
        race_datetime: race.race_datetime,
        distance_m: race.distanceM,
        track_condition: race.track_condition,
        race_class: race.raceClass,
        status: 'upcoming',
      }, { onConflict: 'racecourse_id,race_datetime' })

      if (error) {
        console.error(`Failed to insert race ${race.racecourse} ${race.race_datetime}:`, error)
      } else {
        created += 1
      }
    }

    console.log(`Upserted ${created} Victoria races`)
  } catch (error) {
    console.error('Scrape failed:', error)
  }
}

function extractRaceBlocks(html: string) {
  const races = []
  const racecourseRegex = /<h2[^>]*>([^<]+)<\/h2>/gi
  const raceTimeRegex = /<time[^>]*datetime="([^"]+)"[^>]*>([^<]+)<\/time>/gi
  const distanceRegex = /(\d+)m/gi
  const classRegex = /(BM\d+|Listed|Group\s*\d+|Maiden|Open|F\&M[^<\n]*)/gi

  let match
  while ((match = racecourseRegex.exec(html)) !== null) {
    const racecourse = match[1].trim()
    if (!isVictoriaRacecourse(racecourse)) continue

    const startIndex = match.index
    const nextRacecourse = html.indexOf('<h2', startIndex + 1)
    const block = html.slice(startIndex, nextRacecourse === -1 ? html.length : nextRacecourse)

    const timeMatch = block.match(raceTimeRegex)
    const raceDatetime = timeMatch ? timeMatch[1] : new Date(Date.now() + 86400000).toISOString()

    const distanceMatch = block.match(distanceRegex)
    const distanceM = distanceMatch ? Number(distanceMatch[1]) : null

    const classMatch = block.match(classRegex)
    const raceClass = classMatch ? classMatch[0] : null

    races.push({
      racecourse,
      race_datetime: raceDatetime,
      distanceM,
      raceClass,
      track_condition: null,
    })
  }

  return races
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

scrapeRacingComVictoria().catch((error) => {
  console.error('Scraper failed', error)
  process.exit(1)
})
