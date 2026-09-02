/**
 * Normalized domain types for PuntersEdge data + the (partial) shapes we rely on from its JSON
 * responses. Only fields this codebase actually reads are typed - see /memories/repo/
 * puntersedge-api.md for the full verified field list and gotchas researched against the live
 * docs/sandbox on 2026-09-01.
 */

export type RacingCategory = 'horse' | 'greyhound' | 'harness'

export const TAB_BOOKMAKER_KEY = 'tab'

export interface PeBookmakerPrice {
  key: string
  win_price?: number | null
  place_price?: number | null
  source_url?: string
  age_seconds?: number
  last_update?: string
  stale?: boolean
}

export interface PeRunner {
  name: string
  /** Verified live: can be null when the primary program-number source hasn't resolved yet, even though barrier/trainer/form are already populated. */
  number: number | null
  barrier?: number | null
  jockey?: string | null
  trainer?: string | null
  weight?: number | null
  form?: string | null
  bookmakers: PeBookmakerPrice[]
}

export interface PeScratching {
  name: string
  number: number
  barrier?: number | null
}

export interface PeNextToGoRace {
  race_id: string
  venue: string
  race_number: number
  category: RacingCategory
  start_time: string
  country: string | null
  race_name?: string | null
  distance_m?: number | null
  track_condition?: string | null
  weather?: string | null
  runners: PeRunner[]
  scratchings: PeScratching[]
  data_age_seconds: number
  stale: boolean
  stale_bookmakers?: string[]
  freshest_age_seconds?: number
}

export interface PeResultPlacing {
  name: string
  number: number
  position: number
  win_price?: number | null
  place_price?: number | null
}

/** A scratched runner's win/place deduction fractions, verified against the real /v1/racing/results payload. */
export interface PeResultDeduction {
  name: string
  number: number
  win: number
  place: number
  scratched_at: string
}

export interface PeRaceResult {
  race_id: string
  venue: string
  race_number: number
  category: RacingCategory
  status: 'final' | 'interim'
  country: string | null
  /** Only the dividend-bearing placegetters (paid places for this field size) - not the full field. */
  placings: PeResultPlacing[]
  deductions?: PeResultDeduction[]
  dividends?: Record<string, unknown>
}

export interface PeUsage {
  credits_used: number
  credits_remaining: number
  period_start: string
  next_reset_at: string
  usage_by_endpoint_period?: Record<string, number>
}

export interface NextToGoParams {
  numRaces?: number
  categories?: RacingCategory[]
  bookmakers?: string[]
  country?: string[]
  venue?: string[]
  includeUnresolved?: boolean
}

export interface ResultsParams {
  hoursBack?: number
  date?: string
  categories?: RacingCategory[]
  venue?: string
  country?: string[]
  status?: 'final' | 'interim'
  limit?: number
  offset?: number
}
