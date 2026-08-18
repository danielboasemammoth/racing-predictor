import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ENDPOINT = 'https://graphql.rmdprod.racing.com/'
const PUBLIC_API_KEY = 'da2-6nsi4ztsynar3l3frgxf77q5fe'

const MEETINGS_QUERY = `
  query Meetings($states: String!, $daysBack: Int!, $daysForward: Int!, $userDate: String!) {
    GetRaceMeetingsByStateNew(states: $states, daysBack: $daysBack, daysForward: $daysForward, userDate: $userDate) {
      id venue date state isTrial isJumpOut meetUrl sortOrder
    }
  }
`

const RACES_QUERY = `
  query Races($meetCode: ID!) {
    getRacesForMeet(meetCode: $meetCode) {
      id condition rdcClass raceNumber raceStatus distance time raceTime class group name prizeMoney
      meet { trackCondition trackRating weather state }
      formRaceEntries {
        id position barrierNumber scratched raceEntryNumber weight horseName horseCountry horseCode
        trainerName jockeyName trainerCode jockeyCode margin winningTime
        odds { providerCode oddsWin oddsPlace }
        horse { id stats { starts firsts seconds thirds } }
      }
    }
  }
`

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'x-api-key': process.env.RACING_COM_API_KEY ?? PUBLIC_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> }
  if (payload.errors?.length) throw new Error(payload.errors.map(({ message }) => message).join('; '))
  return payload.data as T
}

async function main() {
  // Get today's date
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: 'numeric',
  }).format(new Date())

  console.log('Today (Melbourne):', today)

  // Get meetings from last 2 days
  const meetings = await graphql<{ GetRaceMeetingsByStateNew: any[] }>(MEETINGS_QUERY, {
    states: 'VIC',
    daysBack: 2,
    daysForward: 0,
    userDate: today,
  })

  // Check DB races for today
  const todayStart = new Date().toISOString().split('T')[0]
  const { data: dbRaces } = await supabase
    .from('races')
    .select('id, race_datetime, status, external_id, racecourses(name)')
    .gte('race_datetime', todayStart + 'T00:00:00')
    .lte('race_datetime', todayStart + 'T23:59:59')
    .order('race_datetime', { ascending: true })

  console.log('\n=== DB races for today:', dbRaces?.length ?? 0, '===')
  for (const dbRace of dbRaces ?? []) {
    const dbTime = new Date(dbRace.race_datetime).toLocaleString('en-AU')
    console.log(`DB: ${dbTime} ${(dbRace as any).racecourses?.name} ${dbRace.status} ext=${dbRace.external_id}`)
    
    const { data: dbEntries } = await supabase
      .from('race_entries')
      .select('finishing_position, status')
      .eq('race_id', dbRace.id)
    
    const positions = (dbEntries ?? []).map(e => e.finishing_position)
    console.log('  DB positions:', JSON.stringify(positions))
    
    // Now check API for matching race
    if (dbRace.external_id) {
      // Extract API race ID from external_id
      const apiRaceId = dbRace.external_id.replace('racing-com:race:', '')
      // We need to find the meeting code... but we can try fetching all VIC meetings
    }
  }

  // Check API status values
  console.log('\n=== API race status values ===')
  const apiRaces: any[] = []
  for (const meeting of meetings.GetRaceMeetingsByStateNew.slice(0, 3)) {
    try {
      const races = await graphql<{ getRacesForMeet: any[] }>(RACES_QUERY, { meetCode: meeting.id })
      races.getRacesForMeet.forEach((r: any) => {
        apiRaces.push({
          raceNumber: r.raceNumber,
          name: r.name,
          status: r.raceStatus,
          raceId: r.id,
          venue: meeting.venue,
          entries: r.formRaceEntries.length,
          positions: r.formRaceEntries.map((e: any) => e.position),
        })
      })
    } catch (e) {
      console.log('Error fetching', meeting.venue, (e as Error).message)
    }
  }

  // Group by status
  const byStatus: Record<string, any[]> = {}
  apiRaces.forEach((r) => {
    const key = r.status || 'unknown'
    if (!byStatus[key]) byStatus[key] = []
    byStatus[key].push(r)
  })

  Object.entries(byStatus).forEach(([status, races]) => {
    console.log(`\nStatus "${status}": ${races.length} races`)
    races.slice(0, 3).forEach((r) => {
      console.log(`  ${r.venue} R${r.raceNumber} ${r.name} entries=${r.entries} positions=${JSON.stringify(r.positions)}`)
    })
  })
}

main().catch((e) => { console.error('Error:', e); process.exit(1) })
