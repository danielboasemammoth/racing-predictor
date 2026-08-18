import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

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
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: 'numeric',
  }).format(new Date())

  const meetings = await graphql<{ GetRaceMeetingsByStateNew: any[] }>(MEETINGS_QUERY, {
    states: 'VIC',
    daysBack: 5,
    daysForward: 0,
    userDate: today,
  })

  const allPositions = new Set<number>()
  const statusValues = new Set<string>()

  for (const meeting of meetings.GetRaceMeetingsByStateNew.slice(0, 8)) {
    try {
      const races = await graphql<{ getRacesForMeet: any[] }>(RACES_QUERY, { meetCode: meeting.id })
      races.getRacesForMeet.forEach((r: any) => {
        statusValues.add(r.raceStatus)
        r.formRaceEntries.forEach((e: any) => {
          if (e.position !== null) allPositions.add(e.position)
        })
      })
    } catch (e) {
      console.log('Error:', (e as Error).message)
    }
  }

  console.log('All position values from API:', [...allPositions].sort((a, b) => a - b))
  console.log('All race status values:', [...statusValues])
}

main().catch((e) => { console.error('Error:', e); process.exit(1) })
