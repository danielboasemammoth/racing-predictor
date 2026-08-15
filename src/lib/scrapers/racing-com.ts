import type { SupabaseClient } from '@supabase/supabase-js'

const ENDPOINT = 'https://graphql.rmdprod.racing.com/'
const PUBLIC_API_KEY = 'da2-6nsi4ztsynar3l3frgxf77q5fe'
const SOURCE_NAME = 'Racing.com'

const MEETINGS_QUERY = `
  query Meetings($states: String!, $daysBack: Int!, $daysForward: Int!, $userDate: String!) {
    GetRaceMeetingsByStateNew(
      states: $states
      daysBack: $daysBack
      daysForward: $daysForward
      userDate: $userDate
    ) {
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

export interface RacingMeeting {
  id: string
  venue: string
  date: string
  state: string
  isTrial: boolean
  isJumpOut: boolean
  meetUrl: string
}

interface RacingStats {
  starts: string
  firsts: string
  seconds: string
  thirds: string
}

export interface RacingEntry {
  id: string
  position: number | null
  barrierNumber: number | null
  scratched: boolean
  raceEntryNumber: number
  weight: string | null
  horseName: string
  horseCountry: string | null
  horseCode: string
  trainerName: string | null
  jockeyName: string | null
  margin: string | number | null
  winningTime: string | number | null
  odds: Array<{
    providerCode: string
    oddsWin: string | number | null
    oddsPlace: string | number | null
  }>
  horse: { id: string; stats: RacingStats[] } | null
}

export interface RacingRace {
  id: string
  condition: string | null
  rdcClass: string | null
  raceNumber: number
  raceStatus: string
  distance: string
  time: string
  raceTime: string | number | null
  class: string | null
  group: string | null
  name: string
  prizeMoney: string[] | null
  meet: {
    trackCondition: string | null
    trackRating: string | null
    weather: string | null
    state: string
  }
  formRaceEntries: RacingEntry[]
}

export interface IngestionSummary {
  meetings: number
  races: number
  horses: number
  entries: number
  skippedMeetings: number
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'RacingPredictor/1.0 (+https://github.com/danielboasemammoth/racing-predictor)',
      'x-api-key': process.env.RACING_COM_API_KEY ?? PUBLIC_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) throw new Error(`Racing.com returned HTTP ${response.status}`)
  const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> }
  if (payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.map(({ message }) => message).join('; ') || 'Racing.com returned no data')
  }
  return payload.data
}

export async function fetchMeetings(userDate: string, daysBack = 1, daysForward = 3) {
  const data = await graphql<{ GetRaceMeetingsByStateNew: RacingMeeting[] }>(MEETINGS_QUERY, {
    states: 'VIC',
    daysBack,
    daysForward,
    userDate,
  })
  return data.GetRaceMeetingsByStateNew.filter((meeting) => !meeting.isTrial && !meeting.isJumpOut)
}

export async function fetchRaces(meetCode: string) {
  const data = await graphql<{ getRacesForMeet: RacingRace[] }>(RACES_QUERY, { meetCode })
  return data.getRacesForMeet
}

export function parseDistance(value: string) {
  const distance = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(distance) ? distance : null
}

export function parseWeight(value: string | null) {
  if (!value) return null
  const weight = Number.parseFloat(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(weight) ? weight : null
}

export function parsePrice(value: string | number | null) {
  if (typeof value === 'number') return value > 0 ? value : null
  if (!value) return null
  const price = Number.parseFloat(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(price) && price > 0 ? price : null
}

export function parseFinishingTime(value: string | number | null) {
  if (typeof value === 'number') return value > 1_000 ? value / 100 : value
  if (!value) return null
  const parts = value.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] > 1_000 ? parts[0] / 100 : parts[0]
}

export function totalPrizeMoney(values: string[] | null) {
  return (values ?? []).reduce((total, value) => {
    try {
      const parsed = JSON.parse(value) as { Value?: string }
      return total + (Number.parseFloat(parsed.Value ?? '0') || 0)
    } catch {
      return total
    }
  }, 0)
}

function raceStatus(race: RacingRace): 'upcoming' | 'live' | 'completed' | 'cancelled' {
  const status = race.raceStatus.toLowerCase()
  if (status.includes('abandon') || status.includes('cancel')) return 'cancelled'
  if (race.formRaceEntries.some((entry) => entry.position !== null) || status.includes('result')) return 'completed'
  if (status.includes('running') || status.includes('interim')) return 'live'
  return 'upcoming'
}

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function ingestRacingCom(
  supabase: SupabaseClient,
  userDate: string,
  options: { daysBack?: number; daysForward?: number; maxMeetings?: number } = {},
): Promise<IngestionSummary> {
  const meetings = await fetchMeetings(userDate, options.daysBack ?? 1, options.daysForward ?? 3)
  const summary: IngestionSummary = { meetings: 0, races: 0, horses: 0, entries: 0, skippedMeetings: 0 }

  for (const meeting of meetings.slice(0, options.maxMeetings ?? 12)) {
    const { data: existingCourse, error: courseReadError } = await supabase
      .from('racecourses')
      .select('id')
      .eq('name', meeting.venue)
      .eq('state', meeting.state)
      .maybeSingle()
    if (courseReadError) throw courseReadError

    let racecourseId = existingCourse?.id as string | undefined
    if (!racecourseId) {
      const { data: course, error: courseError } = await supabase
        .from('racecourses')
        .insert({ name: meeting.venue, state: meeting.state, region: 'Victoria' })
        .select('id')
        .single()
      if (courseError) throw courseError
      racecourseId = course.id
    }

    const races = await fetchRaces(meeting.id)
    if (!races.length) {
      summary.skippedMeetings += 1
      continue
    }
    summary.meetings += 1

    const updatedAt = new Date().toISOString()
    const { data: storedRaces, error: raceError } = await supabase
      .from('races')
      .upsert(races.map((race) => ({
          external_id: `racing-com:race:${race.id}`,
          racecourse_id: racecourseId,
          race_number: race.raceNumber,
          race_name: race.name,
          distance_m: parseDistance(race.distance),
          track_condition: [race.meet.trackCondition, race.meet.trackRating].filter(Boolean).join(' '),
          weather_condition: race.meet.weather,
          race_class: race.class ?? race.rdcClass,
          prize_money: totalPrizeMoney(race.prizeMoney),
          race_datetime: race.time,
          status: raceStatus(race),
          updated_at: updatedAt,
        })), { onConflict: 'external_id' })
      .select('id, external_id')
    if (raceError) throw raceError
    summary.races += races.length
    const raceIds = new Map((storedRaces ?? []).map((race) => [race.external_id, race.id]))
    const sourceEntries = races.flatMap((race) => race.formRaceEntries
      .filter((entry) => entry.horseCode && entry.horseName)
      .map((entry) => ({ race, entry })))

    const horseRows = new Map<string, Record<string, unknown>>()
    for (const { entry } of sourceEntries) {
      const career = entry.horse?.stats?.[0]
      horseRows.set(entry.horseCode, {
            external_id: `racing-com:horse:${entry.horseCode}`,
            name: entry.horseName,
            trainer: entry.trainerName,
            career_runs: Number.parseInt(career?.starts ?? '0', 10) || 0,
            career_wins: Number.parseInt(career?.firsts ?? '0', 10) || 0,
            career_places: (Number.parseInt(career?.seconds ?? '0', 10) || 0)
              + (Number.parseInt(career?.thirds ?? '0', 10) || 0),
            updated_at: updatedAt,
      })
    }
    const { data: storedHorses, error: horseError } = await supabase
      .from('horses')
      .upsert([...horseRows.values()], { onConflict: 'external_id' })
      .select('id, external_id')
    if (horseError) throw horseError
    summary.horses += horseRows.size
    const horseIds = new Map((storedHorses ?? []).map((horse) => [horse.external_id, horse.id]))

    const entryRows = sourceEntries.flatMap(({ race, entry }) => {
      const raceId = raceIds.get(`racing-com:race:${race.id}`)
      const horseId = horseIds.get(`racing-com:horse:${entry.horseCode}`)
      if (!raceId || !horseId) return []
      return [{
          race_id: raceId,
          horse_id: horseId,
          barrier_number: entry.barrierNumber,
          weight_carried: parseWeight(entry.weight),
          jockey: entry.jockeyName,
          trainer: entry.trainerName,
          finishing_position: entry.position,
          finishing_time: parseFinishingTime(entry.winningTime ?? race.raceTime),
          sectional_times: {
            odds: entry.odds.map((quote) => ({
              provider: quote.providerCode,
              win: parsePrice(quote.oddsWin),
              place: parsePrice(quote.oddsPlace),
            })),
            captured_at: updatedAt,
          },
          margin: typeof entry.margin === 'string' ? Number.parseFloat(entry.margin) || null : entry.margin,
          status: entry.scratched ? 'scratched' : entry.position !== null ? 'finished' : 'running',
          updated_at: updatedAt,
      }]
    })
    const { error: entryError } = await supabase
      .from('race_entries')
      .upsert(entryRows, { onConflict: 'race_id,horse_id' })
    if (entryError) throw entryError
    summary.entries += entryRows.length

    await delay(300)
  }

  const { data: source, error: sourceReadError } = await supabase
    .from('data_sources')
    .select('id')
    .eq('name', SOURCE_NAME)
    .maybeSingle()
  if (sourceReadError) throw sourceReadError

  const sourceRecord = {
    name: SOURCE_NAME,
    source_type: 'api',
    url: 'https://www.racing.com/form-guide',
    last_synced: new Date().toISOString(),
    sync_frequency: 'manual',
    active: true,
  }
  const sourceResult = source
    ? await supabase.from('data_sources').update(sourceRecord).eq('id', source.id)
    : await supabase.from('data_sources').insert(sourceRecord)
  if (sourceResult.error) throw sourceResult.error

  return summary
}