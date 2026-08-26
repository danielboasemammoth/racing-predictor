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
      tempo straight circumference
      meet { trackCondition trackRating weather state }
      stewardsReport { htmlCode }
      raceEntryTimes {
        horseCode horseName avgSpeedEarly avgSpeedMid avgSpeedLate overallPeakSpeed overallAvgSpeed
        sixHundredMetresTime standardTimeDifference
        splitTimes { avgSpeed distance index position time }
      }
      formRaceEntries {
        id position barrierNumber scratched raceEntryNumber weight horseName horseCountry horseCode
        trainerName jockeyName trainerCode jockeyCode margin winningTime
        positionAt800 positionAt400 positionAtSettled commentStewards gearChanges handicapRating startingPrice
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
  positionAt800: number | null
  positionAt400: number | null
  positionAtSettled: number | null
  commentStewards: string | null
  gearChanges: string | null
  handicapRating: string | number | null
  startingPrice: string | number | null
  odds: Array<{
    providerCode: string
    oddsWin: string | number | null
    oddsPlace: string | number | null
  }>
  horse: { id: string; stats: RacingStats[] } | null
}

export interface RacingSplitTime {
  avgSpeed: number | null
  distance: string
  index: number
  position: number | null
  time: string | null
}

export interface RacingEntryTimes {
  horseCode: string
  horseName: string
  avgSpeedEarly: number | null
  avgSpeedMid: number | null
  avgSpeedLate: number | null
  overallPeakSpeed: number | null
  overallAvgSpeed: number | null
  sixHundredMetresTime: string | null
  standardTimeDifference: string | null
  splitTimes: RacingSplitTime[] | null
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
  tempo: string | null
  straight: string | null
  circumference: string | null
  stewardsReport: { htmlCode: string | null } | null
  raceEntryTimes: RacingEntryTimes[] | null
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

export function selectMeetings(meetings: RacingMeeting[], maxMeetings?: number) {
  return maxMeetings === undefined ? meetings : meetings.slice(0, Math.max(0, maxMeetings))
}

/** Groups the horse IDs that belong to each race in the current fetch, used to remove stale entries left by earlier syncs. */
export function groupValidHorseIdsByRace(entryRows: Array<{ race_id: string; horse_id: string }>) {
  const map = new Map<string, string[]>()
  for (const row of entryRows) {
    const horseIds = map.get(row.race_id) ?? []
    horseIds.push(row.horse_id)
    map.set(row.race_id, horseIds)
  }
  return map
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
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

      // Retry transient upstream failures (Cloudflare 502/503/504) rather than aborting an
      // entire multi-minute ingestion run over a single blip.
      if (!response.ok) {
        if ([502, 503, 504].includes(response.status) && attempt < 3) {
          lastError = new Error(`Racing.com returned HTTP ${response.status}`)
          await delay(1000 * attempt)
          continue
        }
        throw new Error(`Racing.com returned HTTP ${response.status}`)
      }
      const payload = await response.json() as { data?: T; errors?: Array<{ message: string }> }
      if (payload.errors?.length || !payload.data) {
        throw new Error(payload.errors?.map(({ message }) => message).join('; ') || 'Racing.com returned no data')
      }
      return payload.data
    } catch (error) {
      lastError = error
      if (attempt < 3) await delay(1000 * attempt)
    }
  }
  throw lastError
}

export const AUSTRALIAN_STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const

export const STATE_REGIONS: Record<string, string> = {
  VIC: 'Victoria',
  NSW: 'New South Wales',
  QLD: 'Queensland',
  SA: 'South Australia',
  WA: 'Western Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
  ACT: 'Australian Capital Territory',
}

export async function fetchMeetings(userDate: string, daysBack = 1, daysForward = 3, states: readonly string[] = AUSTRALIAN_STATES) {
  // The API always folds VIC meetings into every response regardless of the requested state, so dedupe by id.
  const meetingsById = new Map<string, RacingMeeting>()
  for (const state of states) {
    const data = await graphql<{ GetRaceMeetingsByStateNew: RacingMeeting[] }>(MEETINGS_QUERY, {
      states: state,
      daysBack,
      daysForward,
      userDate,
    })
    for (const meeting of data.GetRaceMeetingsByStateNew) {
      if (!meeting.isTrial && !meeting.isJumpOut) meetingsById.set(meeting.id, meeting)
    }
    await delay(200)
  }
  return [...meetingsById.values()]
}

export async function fetchRaces(meetCode: string) {
  const data = await graphql<{ getRacesForMeet: RacingRace[] }>(RACES_QUERY, { meetCode })
  return data.getRacesForMeet
}

export function parsePosition(value: number | null): number | null {
  if (value === null) return null
  if (value > 50) return null // API codes like 109 = unplaced/DNF
  return value
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

export function parseMetres(value: string | null) {
  if (!value) return null
  const metres = Number.parseInt(value.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(metres) ? metres : null
}

export function parseRating(value: string | number | null) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (!value) return null
  const rating = Number.parseFloat(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(rating) ? rating : null
}

/** Structures one runner's sectional splits/speed ratings for storage - null when Racing.com has no sectionals for this race yet. */
export function buildSpeedRatings(entryTimes: RacingEntryTimes | undefined) {
  if (!entryTimes) return null
  return {
    avg_speed_early: entryTimes.avgSpeedEarly,
    avg_speed_mid: entryTimes.avgSpeedMid,
    avg_speed_late: entryTimes.avgSpeedLate,
    peak_speed: entryTimes.overallPeakSpeed,
    overall_avg_speed: entryTimes.overallAvgSpeed,
    six_hundred_time: entryTimes.sixHundredMetresTime,
    standard_time_difference: entryTimes.standardTimeDifference,
    splits: (entryTimes.splitTimes ?? []).map((split) => ({
      distance: split.distance,
      avg_speed: split.avgSpeed,
      position: split.position,
      time: split.time,
    })),
  }
}

/** Structures one runner's in-running positions - null until Racing.com has post-race data. */
export function buildRunningPositions(entry: RacingEntry) {
  if (entry.positionAt800 == null && entry.positionAt400 == null && entry.positionAtSettled == null) return null
  return {
    at_800m: entry.positionAt800,
    at_400m: entry.positionAt400,
    at_settled: entry.positionAtSettled,
  }
}

/** Race-level fields shared between the bulk sync and the single-race refresh, so they can't drift apart. */
function buildRaceFields(race: RacingRace) {
  return {
    race_name: race.name,
    distance_m: parseDistance(race.distance),
    track_condition: [race.meet.trackCondition, race.meet.trackRating].filter(Boolean).join(' '),
    weather_condition: race.meet.weather,
    race_class: race.class ?? race.rdcClass,
    prize_money: totalPrizeMoney(race.prizeMoney),
    race_datetime: race.time,
    stewards_report_html: race.stewardsReport?.htmlCode ?? null,
    tempo: race.tempo,
    track_straight_m: parseMetres(race.straight),
    track_circumference_m: parseMetres(race.circumference),
  }
}

/** Per-runner fields shared between the bulk sync and the single-race refresh, so they can't drift apart. */
function buildEntryFields(entry: RacingEntry, race: RacingRace, updatedAt: string, entryTimesByHorseCode: Map<string, RacingEntryTimes>) {
  return {
    barrier_number: entry.barrierNumber,
    weight_carried: parseWeight(entry.weight),
    jockey: entry.jockeyName,
    trainer: entry.trainerName,
    finishing_position: parsePosition(entry.position),
    finishing_time: parseFinishingTime(entry.winningTime ?? race.raceTime),
    sectional_times: {
      odds: entry.odds.map((quote) => ({
        provider: quote.providerCode,
        win: parsePrice(quote.oddsWin),
        place: parsePrice(quote.oddsPlace),
      })),
      captured_at: updatedAt,
    },
    speed_ratings: buildSpeedRatings(entryTimesByHorseCode.get(entry.horseCode)),
    running_positions: buildRunningPositions(entry),
    stewards_comment: entry.commentStewards || null,
    gear_changes: entry.gearChanges || null,
    handicap_rating: parseRating(entry.handicapRating),
    starting_price: parsePrice(entry.startingPrice),
    margin: typeof entry.margin === 'string' ? Number.parseFloat(entry.margin) || null : entry.margin,
    status: entry.scratched ? 'scratched' : parsePosition(entry.position) !== null ? 'finished' : 'running',
    updated_at: updatedAt,
  }
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

export function raceStatus(race: RacingRace): 'upcoming' | 'live' | 'completed' | 'cancelled' {
  const status = race.raceStatus.toLowerCase()
  if (status.includes('abandon') || status.includes('cancel')) return 'cancelled'
  if (race.formRaceEntries.some((entry) => parsePosition(entry.position) !== null) || status.includes('result')) return 'completed'
  if (status.includes('running') || status.includes('interim')) return 'live'
  return 'upcoming'
}

async function delay(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function ingestRacingCom(
  supabase: SupabaseClient,
  userDate: string,
  options: { daysBack?: number; daysForward?: number; maxMeetings?: number; states?: readonly string[] } = {},
): Promise<IngestionSummary> {
  const meetings = await fetchMeetings(userDate, options.daysBack ?? 1, options.daysForward ?? 3, options.states)
  const summary: IngestionSummary = { meetings: 0, races: 0, horses: 0, entries: 0, skippedMeetings: 0 }

  for (const meeting of selectMeetings(meetings, options.maxMeetings)) {
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
        .insert({ name: meeting.venue, state: meeting.state, region: STATE_REGIONS[meeting.state] ?? meeting.state })
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
          ...buildRaceFields(race),
          external_id: `racing-com:race:${race.id}`,
          racecourse_id: racecourseId,
          race_number: race.raceNumber,
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

    const entryTimesByRace = new Map(races.map((race) => [race.id, new Map((race.raceEntryTimes ?? []).map((times) => [times.horseCode, times]))]))
    const entryRows = sourceEntries.flatMap(({ race, entry }) => {
      const raceId = raceIds.get(`racing-com:race:${race.id}`)
      const horseId = horseIds.get(`racing-com:horse:${entry.horseCode}`)
      if (!raceId || !horseId) return []
      const entryTimesByHorseCode = entryTimesByRace.get(race.id) ?? new Map()
      return [{
          race_id: raceId,
          horse_id: horseId,
          ...buildEntryFields(entry, race, updatedAt, entryTimesByHorseCode),
      }]
    })
    const { error: entryError } = await supabase
      .from('race_entries')
      .upsert(entryRows, { onConflict: 'race_id,horse_id' })
    if (entryError) throw entryError
    summary.entries += entryRows.length

    // Remove entries left behind when a horse drops out of the field entirely (not just marked scratched)
    // between syncs, so races never accumulate more runners than actually contest them.
    for (const [raceId, validHorseIds] of groupValidHorseIdsByRace(entryRows)) {
      if (!validHorseIds.length) continue
      const { error: cleanupError } = await supabase
        .from('race_entries')
        .delete()
        .eq('race_id', raceId)
        .not('horse_id', 'in', `(${validHorseIds.join(',')})`)
      if (cleanupError) throw cleanupError
    }

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

/** Picks the one race in a refetched meeting matching a stored external_id - never a race_number guess. */
export function findMatchingRace(races: RacingRace[], externalId: string): RacingRace | undefined {
  return races.find((race) => `racing-com:race:${race.id}` === externalId)
}

export interface RefreshRaceResult {
  found: boolean
  raceId: string
  status?: 'upcoming' | 'live' | 'completed' | 'cancelled'
  horses: number
  entries: number
}

/**
 * Refreshes exactly one race's own fields, runners, and odds from Racing.com, without touching
 * any other race. Racing.com's API is queried per-meeting, so this refetches that one race's
 * meeting but only writes rows for the single matched race (see findMatchingRace).
 */
export async function refreshSingleRace(supabase: SupabaseClient, raceId: string): Promise<RefreshRaceResult> {
  const { data: race, error: raceError } = await supabase
    .from('races')
    .select('id, external_id, race_datetime, racecourses(name, state)')
    .eq('id', raceId)
    .maybeSingle()
  if (raceError) throw raceError
  const racecourseRelation = race?.racecourses as { name: string; state: string } | { name: string; state: string }[] | null
  const racecourse = Array.isArray(racecourseRelation) ? racecourseRelation[0] : racecourseRelation
  if (!race?.external_id || !racecourse) return { found: false, raceId, horses: 0, entries: 0 }

  const userDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(race.race_datetime))

  const meetings = await fetchMeetings(userDate, 1, 1, [racecourse.state])
  const meeting = meetings.find((candidate) => candidate.venue === racecourse.name)
  if (!meeting) return { found: false, raceId, horses: 0, entries: 0 }

  const meetingRaces = await fetchRaces(meeting.id)
  const matched = findMatchingRace(meetingRaces, race.external_id)
  if (!matched) return { found: false, raceId, horses: 0, entries: 0 }

  const updatedAt = new Date().toISOString()
  const status = raceStatus(matched)

  const { error: raceUpdateError } = await supabase
    .from('races')
    .update({
      ...buildRaceFields(matched),
      status,
      updated_at: updatedAt,
    })
    .eq('id', race.id)
  if (raceUpdateError) throw raceUpdateError

  const sourceEntries = matched.formRaceEntries.filter((entry) => entry.horseCode && entry.horseName)
  const horseRows = sourceEntries.map((entry) => {
    const career = entry.horse?.stats?.[0]
    return {
      external_id: `racing-com:horse:${entry.horseCode}`,
      name: entry.horseName,
      trainer: entry.trainerName,
      career_runs: Number.parseInt(career?.starts ?? '0', 10) || 0,
      career_wins: Number.parseInt(career?.firsts ?? '0', 10) || 0,
      career_places: (Number.parseInt(career?.seconds ?? '0', 10) || 0)
        + (Number.parseInt(career?.thirds ?? '0', 10) || 0),
      updated_at: updatedAt,
    }
  })
  const { data: storedHorses, error: horseError } = await supabase
    .from('horses')
    .upsert(horseRows, { onConflict: 'external_id' })
    .select('id, external_id')
  if (horseError) throw horseError
  const horseIds = new Map((storedHorses ?? []).map((horse) => [horse.external_id, horse.id]))

  const entryTimesByHorseCode = new Map((matched.raceEntryTimes ?? []).map((times) => [times.horseCode, times]))
  const entryRows = sourceEntries.flatMap((entry) => {
    const horseId = horseIds.get(`racing-com:horse:${entry.horseCode}`)
    if (!horseId) return []
    return [{
      race_id: race.id,
      horse_id: horseId,
      ...buildEntryFields(entry, matched, updatedAt, entryTimesByHorseCode),
    }]
  })

  const { error: entryError } = await supabase
    .from('race_entries')
    .upsert(entryRows, { onConflict: 'race_id,horse_id' })
  if (entryError) throw entryError

  // Same ghost-entry cleanup as the bulk ingestion, scoped to just this race's own rows.
  for (const [scopedRaceId, validHorseIds] of groupValidHorseIdsByRace(entryRows)) {
    if (!validHorseIds.length) continue
    const { error: cleanupError } = await supabase
      .from('race_entries')
      .delete()
      .eq('race_id', scopedRaceId)
      .not('horse_id', 'in', `(${validHorseIds.join(',')})`)
    if (cleanupError) throw cleanupError
  }

  return { found: true, raceId: race.id, status, horses: horseRows.length, entries: entryRows.length }
}