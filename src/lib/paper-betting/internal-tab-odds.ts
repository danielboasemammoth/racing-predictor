import type { SupabaseClient } from '@supabase/supabase-js'
import { findMatchingInternalRace, normalizeHorseName, type InternalRaceCandidate } from '@/lib/paper-betting/fundamentals-bridge'

export interface InternalRaceRef {
  id: string
  racecourseName: string
  raceNumber: number
  raceDatetime: string
}

export interface TabPrice {
  win?: number
  place?: number
  capturedAt: string
}

/**
 * Batch-fetches real TAB fixed-odds prices for as many of the given internal (Racing.com) horse
 * races as can be confidently matched, keyed by internal race id -> normalized horse name. Only
 * ever READS what the existing PuntersEdge sync poll has already collected into
 * pe_races/pe_runners/pe_odds_snapshots - never calls the PuntersEdge API itself.
 * Matching reuses fundamentals-bridge.ts's conservative venue+race_number+time-tolerance logic in
 * the opposite direction (PuntersEdge -> internal, instead of internal -> PuntersEdge) - a race
 * with zero or multiple ambiguous PuntersEdge candidates is simply absent from the result, never
 * guessed.
 * Best-effort/degrading by design: PuntersEdge only prices a race once it's within its own pricing
 * lead time (median ~26 minutes before jump for horse racing), so most races generated well ahead
 * of time will have no match yet - that's expected, not an error. Re-running prediction generation
 * closer to jump time (or later in the day, once more of the PuntersEdge poll's dense 11am-11pm
 * schedule has run) picks up fresher/more-available prices.
 */
export async function getTabPricesForInternalRaces(
  admin: SupabaseClient,
  races: InternalRaceRef[],
): Promise<Map<string, Map<string, TabPrice>>> {
  const result = new Map<string, Map<string, TabPrice>>()
  if (races.length === 0) return result

  const times = races.map((race) => new Date(race.raceDatetime).getTime())
  const windowStart = new Date(Math.min(...times) - 60 * 60_000).toISOString()
  const windowEnd = new Date(Math.max(...times) + 60 * 60_000).toISOString()

  const { data: peRaceRows, error: peRaceError } = await admin
    .from('pe_races')
    .select('id, venue, race_number, start_time')
    .eq('category', 'horse')
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd)
  if (peRaceError) throw new Error(`Failed to look up PuntersEdge candidate races: ${peRaceError.message}`)

  const peCandidates: InternalRaceCandidate[] = (peRaceRows ?? []).map((row) => ({
    raceId: row.id as string,
    racecourseName: row.venue as string,
    raceNumber: row.race_number as number,
    raceDatetime: row.start_time as string,
  }))
  if (peCandidates.length === 0) return result

  const peRaceIdByInternalRaceId = new Map<string, string>()
  for (const race of races) {
    const match = findMatchingInternalRace(race.racecourseName, race.raceNumber, race.raceDatetime, peCandidates)
    if (match) peRaceIdByInternalRaceId.set(race.id, match.raceId)
  }
  if (peRaceIdByInternalRaceId.size === 0) return result

  const matchedPeRaceIds = [...new Set(peRaceIdByInternalRaceId.values())]

  const { data: runnerRows, error: runnerError } = await admin
    .from('pe_runners')
    .select('id, race_id, name')
    .in('race_id', matchedPeRaceIds)
  if (runnerError) throw new Error(`Failed to look up PuntersEdge runners: ${runnerError.message}`)

  const { data: snapshotRows, error: snapshotError } = await admin
    .from('pe_odds_snapshots')
    .select('runner_id, tab_win_price, tab_place_price, captured_at')
    .in('race_id', matchedPeRaceIds)
    .order('captured_at', { ascending: false })
  if (snapshotError) throw new Error(`Failed to look up PuntersEdge odds snapshots: ${snapshotError.message}`)

  // First occurrence per runner wins - rows are ordered captured_at descending, so that's the latest.
  const latestSnapshotByRunnerId = new Map<string, { tab_win_price: number | null; tab_place_price: number | null; captured_at: string }>()
  for (const row of snapshotRows ?? []) {
    const runnerId = row.runner_id as string
    if (!latestSnapshotByRunnerId.has(runnerId)) {
      latestSnapshotByRunnerId.set(runnerId, row as { tab_win_price: number | null; tab_place_price: number | null; captured_at: string })
    }
  }

  const runnerNamesByPeRaceId = new Map<string, Map<string, string>>() // peRaceId -> (runnerId -> normalizedName)
  for (const row of runnerRows ?? []) {
    const peRaceId = row.race_id as string
    const map = runnerNamesByPeRaceId.get(peRaceId) ?? new Map<string, string>()
    map.set(row.id as string, normalizeHorseName(row.name as string))
    runnerNamesByPeRaceId.set(peRaceId, map)
  }

  for (const [internalRaceId, peRaceId] of peRaceIdByInternalRaceId) {
    const runnerNameByRunnerId = runnerNamesByPeRaceId.get(peRaceId)
    if (!runnerNameByRunnerId) continue

    const priceByName = new Map<string, TabPrice>()
    for (const [runnerId, normalizedName] of runnerNameByRunnerId) {
      const snapshot = latestSnapshotByRunnerId.get(runnerId)
      if (!snapshot || (snapshot.tab_win_price == null && snapshot.tab_place_price == null)) continue
      priceByName.set(normalizedName, {
        win: snapshot.tab_win_price ?? undefined,
        place: snapshot.tab_place_price ?? undefined,
        capturedAt: snapshot.captured_at,
      })
    }
    if (priceByName.size > 0) result.set(internalRaceId, priceByName)
  }

  return result
}
