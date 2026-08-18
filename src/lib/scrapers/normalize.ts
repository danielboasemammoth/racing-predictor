import type { RacingEntry, RacingRace } from './racing-com'

export function parsePosition(value: number | null): number | null {
  if (value === null) return null
  if (value > 50) return null // API codes like 109 = unplaced/DNF
  return value
}

export function normalizeRaceStatus(race: RacingRace): 'upcoming' | 'live' | 'completed' | 'cancelled' {
  const status = race.raceStatus.toLowerCase()
  if (status.includes('abandon') || status.includes('cancel')) return 'cancelled'
  const validPositions = (race.formRaceEntries ?? []).filter(
    (entry: RacingEntry) => parsePosition(entry.position) !== null,
  )
  if (validPositions.length > 0 || status.includes('result')) return 'completed'
  if (status.includes('running') || status.includes('interim')) return 'live'
  return 'upcoming'
}

export function normalizeEntryStatus(entry: RacingEntry): string {
  if (entry.scratched) return 'scratched'
  if (parsePosition(entry.position) !== null) return 'finished'
  return 'running'
}
