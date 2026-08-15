/**
 * Scraper utilities for Australian horse racing public sources.
 * Uses conservative scraping patterns to avoid bot detection.
 */

export interface RaceRow {
  externalId?: string
  racecourseId: string
  raceNumber: number
  raceName?: string
  distanceM?: number
  trackCondition?: string
  weatherCondition?: string
  raceClass?: string
  prizeMoney?: number
  raceDatetime: string
  status: 'upcoming' | 'completed'
}

export interface EntryRow {
  externalId?: string
  raceId: string
  horseId: string
  horseName: string
  barrierNumber?: number
  weightCarried?: number
  jockey?: string
  trainer?: string
  finishingPosition?: number
  finishingTime?: number
  margin?: number
  status: 'running' | 'finished' | 'scratched' | 'did_not_finish'
}

export interface HorseRow {
  externalId?: string
  name: string
  sex?: string
  age?: number
  sire?: string
  dam?: string
  trainer?: string
  owner?: string
  careerRuns?: number
  careerWins?: number
  careerPlaces?: number
  totalPrizeMoney?: number
  bestTimeThisDistance?: number
  wetFormRating?: number
  heavyFormRating?: number
  dryFormRating?: number
  lastRaceDate?: string
  lastRaceResult?: string
}
