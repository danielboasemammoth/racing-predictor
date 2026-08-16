import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })
import * as cheerio from 'cheerio'

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

    const $ = cheerio.load(html)
    const races: any[] = []

    $('article, .race-card, .meeting').each((_, element) => {
      const racecourse = $(element).find('h2, .meeting-name, .racecourse').first().text().trim()
      if (!racecourse || !isVictoriaRacecourse(racecourse)) return

      const raceDatetime = $(element).find('time').attr('datetime') || new Date().toISOString()
      const distanceText = $(element).find('.distance, .race-distance').text()
      const distanceMatch = distanceText.match(/(\d+)m/)
      const distanceM = distanceMatch ? Number(distanceMatch[1]) : null

      const classText = $(element).find('.race-class, .class').text()
      const classMatch = classText.match(/(BM\d+|Listed|Group\s*\d+|Maiden|Open|F\&M[^<\n]*)/i)
      const raceClass = classMatch ? classMatch[0] : null

      races.push({
        racecourse,
        race_datetime: raceDatetime,
        distanceM,
        raceClass,
        track_condition: null,
      })
    })

    console.log(`Found ${races.length} Victoria races`)

    let created = 0
    for (const race of races) {
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

    const $ = cheerio.load(html)
    const results: any[] = []

    $('article, .race-card, .meeting').each((_, element) => {
      const racecourse = $(element).find('h2, .meeting-name, .racecourse').first().text().trim()
      if (!racecourse || !isVictoriaRacecourse(racecourse)) return

      const raceDatetime = $(element).find('time').attr('datetime') || new Date().toISOString()
      const entries: any[] = []

      $(element).find('.runner, .horse, .result-row').each((i, runner) => {
        const horseName = $(runner).find('.horse-name, .name').text().trim()
        const positionText = $(runner).find('.position, .pos').text().trim()
        const finishingPosition = positionText ? Number(positionText) : i + 1
        const timeText = $(runner).find('.time, .finish-time').text().trim()
        const finishingTime = parseTime(timeText)

        entries.push({
          horse_name: horseName,
          finishing_position: finishingPosition,
          finishing_time: finishingTime,
          margin: finishingPosition > 1 ? Number((finishingPosition * 0.15).toFixed(2)) : 0,
          barrier_number: undefined,
          weight_carried: undefined,
          jockey: undefined,
          trainer: undefined,
        })
      })

      results.push({
        racecourse,
        race_datetime: raceDatetime,
        distanceM: null,
        track_condition: null,
        race_class: null,
        entries,
      })
    })

    console.log(`Found ${results.length} Victoria result sets`)

    let updated = 0
    for (const result of results) {
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

function parseTime(timeStr: string): number | undefined {
  if (!timeStr) return undefined
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

async function main() {
  console.log('Victoria race scraper starting')
  await scrapeRacingComVictoria()
  console.log('Upcoming scrape complete')
  await scrapeResultsRacingCom()
  console.log('Results scrape complete')
}

main().catch((error) => {
  console.error('Scraper failed', error)
  process.exit(1)
})
