import { melbourneDateKey } from './daily-picks'
import type { RaceWithPrediction } from './types'

interface TabMeeting {
  meetingName: string
  raceType: string
  venueMnemonic: string
  races: Array<{
    raceNumber: number
    raceStartTime: string
    raceStatus: string
    hasParimutuel: boolean
    hasFixedOdds: boolean
    willHaveFixedOdds: boolean
  }>
}

export async function getTabScheduledRaces(races: RaceWithPrediction[], fetcher: typeof fetch = fetch): Promise<RaceWithPrediction[]> {
  const keyFor = (venue: string, number: number, date: string) => `${date}:${venue.trim().toLowerCase().replace(/\s+/g, ' ')}:${number}`
  const dates = [...new Set(races.map(race => melbourneDateKey(race.race_datetime)))]
  const schedules = await Promise.all(dates.map(async date => {
    const response = await fetcher(`https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/${date}/meetings?jurisdiction=VIC`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`TAB schedule unavailable for ${date}: ${response.status}`)
    const data = await response.json() as { meetings: TabMeeting[] }
    if (!Array.isArray(data.meetings)) throw new Error(`Invalid TAB schedule for ${date}`)
    return data.meetings.flatMap(meeting => {
      if (meeting.raceType !== 'R') return []
      if (!Array.isArray(meeting.races)) throw new Error(`Invalid TAB races for ${date}`)
      return meeting.races.filter(race => ['Normal', 'Open'].includes(race.raceStatus)
        && (race.hasParimutuel || race.hasFixedOdds || race.willHaveFixedOdds)).map(race => ({
        key: keyFor(meeting.meetingName, race.raceNumber, date),
        start: race.raceStartTime,
      }))
    })
  }))
  const candidates = schedules.flat()
  const keys = races.map(race => keyFor(race.racecourses?.name ?? '', race.race_number, melbourneDateKey(race.race_datetime)))
  return races.flatMap((race, index) => {
    const key = keys[index]
    if (keys.filter(candidate => candidate === key).length !== 1) return []
    const matches = candidates.filter(candidate => candidate.key === key && Number.isFinite(Date.parse(candidate.start)))
    return matches.length === 1 ? [{ ...race, race_datetime: matches[0].start }] : []
  }).sort((left, right) => Date.parse(left.race_datetime) - Date.parse(right.race_datetime))
}

export async function getTabRaceIds(races: RaceWithPrediction[], fetcher: typeof fetch = fetch): Promise<string[]> {
  return (await getTabScheduledRaces(races, fetcher)).map(race => race.id)
}