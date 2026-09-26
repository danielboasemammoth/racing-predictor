import { melbourneDateKey } from './daily-picks'
import { findMatchingInternalRace, type InternalRaceCandidate } from './paper-betting/fundamentals-bridge'
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

export async function getTabRaceIds(races: RaceWithPrediction[], fetcher: typeof fetch = fetch): Promise<string[]> {
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
      return meeting.races.filter(race => race.raceStatus !== 'Abandoned'
        && (race.hasParimutuel || race.hasFixedOdds || race.willHaveFixedOdds)).map(race => ({
        raceId: `${date}-${meeting.venueMnemonic}-${race.raceNumber}`,
        racecourseName: meeting.meetingName,
        raceNumber: race.raceNumber,
        raceDatetime: race.raceStartTime,
      } satisfies InternalRaceCandidate))
    })
  }))
  const candidates = schedules.flat()
  return races.filter(race => findMatchingInternalRace(
    race.racecourses?.name ?? '', race.race_number, race.race_datetime, candidates,
  )).map(race => race.id)
}