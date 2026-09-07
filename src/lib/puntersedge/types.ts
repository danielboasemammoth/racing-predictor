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

/**
 * A single win/place fixed or mid-tote dividend line. `market` is the authoritative signal for
 * "did this position actually get paid" - verified live (2026-09-04): `placings` can list more
 * finishers (e.g. 1st-4th) than actually paid a PLC dividend (e.g. greyhound racing standardly
 * pays only 1st-2nd place regardless of field size, unlike horse racing which scales 1-2-3 for
 * 8+ runners). Never infer "this runner placed" from mere presence in `placings` - cross-check
 * against a PLC line here instead.
 */
export interface PeStraightDividend {
  name: string
  number: number
  position: number
  market: 'WIN' | 'PLC'
  product: string
  amount: number
}

export interface PeRaceResult {
  race_id: string
  venue: string
  race_number: number
  category: RacingCategory
  status: 'final' | 'interim'
  country: string | null
  /** The finishing order PuntersEdge returned (commonly top 4) - NOT all of these paid a place dividend, see PeStraightDividend. */
  placings: PeResultPlacing[]
  deductions?: PeResultDeduction[]
  dividends?: {
    straight?: PeStraightDividend[]
    exotics?: unknown[]
    straight_types?: string[]
  }
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

/** One past run from GET /v1/racing/greyhounds/form (3cr) - verified live 2026-09-07. */
export interface PeGreyhoundFormRun {
  date: string
  track: string
  distance_m: number
  grade: string | null
  race_number: number
  box: number | null
  rug: number | null
  weight_kg: number | null
  sp: number | null
  position: number | null
  scratched: boolean
  time_s: number | null
  win_time_s: number | null
  /** e.g. "6.50L" - human-readable margin behind the winner (or ahead, if this dog won). */
  margin: string | null
  /** Margin in seconds behind the winner - null for the winner's own run and some historical rows. */
  margin_s: number | null
  grade_in: string | null
  grade_out: string | null
  trainer: { id: number; name: string } | null
}

/** `ambiguous`/`candidates` signal PuntersEdge couldn't uniquely resolve the dog name - treat as no data, never guess a candidate. */
export interface PeGreyhoundForm {
  dog_id: number
  dog_name: string
  ambiguous: boolean
  candidates: Array<{ dog_id: number; dog_name: string }>
  runs: PeGreyhoundFormRun[]
}

export interface PeGreyhoundStatsGroup {
  track: string | null
  distance_m: number | null
  box: number | null
  grade: string | null
  starts: number
  wins: number
  places: number
  win_pct: number
  place_pct: number
  avg_time_s: number | null
  best_time_s: number | null
}

/** GET /v1/racing/greyhounds/stats (3cr). `by` accepts track/distance/box/grade, comma-separated - defaults to track. */
export interface PeGreyhoundStats {
  dog_id: number
  dog_name: string
  ambiguous: boolean
  candidates: Array<{ dog_id: number; dog_name: string }>
  group_by: string[]
  groups: PeGreyhoundStatsGroup[]
}

