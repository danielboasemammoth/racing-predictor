import type { SupabaseClient } from '@supabase/supabase-js'
import { findMatchingInternalRace, normalizeHorseName, type InternalRaceCandidate } from '@/lib/paper-betting/fundamentals-bridge'
import { melbourneDateKey } from '@/lib/daily-picks'
import { isSimulationDecisionQuote, isSimulationSelectionQuote, isSimulationTabQuote } from '@/lib/betting/historical-simulator'

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
  quotedAt?: string
  placeTerms?: { source: 'TAB'; product: 'fixed-place'; paidPlaces: 2 | 3; fieldSize: number; capturedAt: string }
}

async function matchTabRaces(admin: SupabaseClient, races: InternalRaceRef[], strict: boolean) {
  const times = races.map((race) => new Date(race.raceDatetime).getTime())
  const windowStart = new Date(Math.min(...times) - 60 * 60_000).toISOString()
  const windowEnd = new Date(Math.max(...times) + 60 * 60_000).toISOString()

  const { data: peRaceRows, error: peRaceError } = await admin
    .from('pe_races')
    .select('id, venue, race_number, start_time')
    .eq('category', 'horse')
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd)
    .limit(1000)
    .abortSignal(AbortSignal.timeout(30000))
    .retry(false)
  if (peRaceError) throw new Error(`Failed to look up PuntersEdge candidate races: ${peRaceError.message}`)
  if (strict && peRaceRows?.length === 1000) throw new Error('TAB candidate race limit reached; refusing incomplete matching')

  const peCandidates: InternalRaceCandidate[] = (peRaceRows ?? []).map((row) => ({
    raceId: row.id as string,
    racecourseName: row.venue as string,
    raceNumber: row.race_number as number,
    raceDatetime: row.start_time as string,
  }))
  if (peCandidates.length === 0) return null

  const peRaceIdByInternalRaceId = new Map<string, string>()
  for (const race of races) {
    const match = findMatchingInternalRace(race.racecourseName, race.raceNumber, race.raceDatetime, peCandidates, strict ? 5 : 20)
    if (match) peRaceIdByInternalRaceId.set(race.id, match.raceId)
  }
  if (peRaceIdByInternalRaceId.size === 0) return null

  const matchedPeRaceIds = [...new Set(peRaceIdByInternalRaceId.values())]

  const { data: runnerRows, error: runnerError } = await admin
    .from('pe_runners')
    .select('id, race_id, name')
    .in('race_id', matchedPeRaceIds)
    .limit(1000)
    .abortSignal(AbortSignal.timeout(30000))
    .retry(false)
  if (runnerError) throw new Error(`Failed to look up PuntersEdge runners: ${runnerError.message}`)
  if (strict && runnerRows?.length === 1000) throw new Error('TAB runner limit reached; refusing incomplete matching')

  return { peRaceIdByInternalRaceId, matchedPeRaceIds, runnerRows }
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
  nearStartOnly = false,
  decisionAt?: string,
  timing: 'decision' | 'selection' = 'decision',
): Promise<Map<string, Map<string, TabPrice>>> {
  const result = new Map<string, Map<string, TabPrice>>()
  const strict = nearStartOnly || decisionAt !== undefined
  if (decisionAt !== undefined && (!Number.isFinite(Date.parse(decisionAt)) || nearStartOnly)) throw new Error('Invalid decision-time TAB lookup')
  if (timing === 'selection' && decisionAt === undefined) throw new Error('Selection-time TAB lookup requires a timestamp')
  if (races.length === 0) return result
  if (strict && races.length > 20) throw new Error('Verified TAB lookup is limited to 20 races')

  const matched = await matchTabRaces(admin, races, strict)
  if (!matched) return result
  const { peRaceIdByInternalRaceId, matchedPeRaceIds, runnerRows } = matched
  const times = races.map((race) => new Date(race.raceDatetime).getTime())

  const snapshotRows: Array<{ runner_id: string; tab_win_price: number | null; tab_place_price: number | null; captured_at: string; tab_age_seconds: number | null }> = []
  for (let offset = 0; ; offset += 500) {
    let query = admin.from('pe_odds_snapshots')
      .select('id, runner_id, tab_win_price, tab_place_price, captured_at, tab_age_seconds')
      .in('race_id', matchedPeRaceIds)
      .order('captured_at', { ascending: false }).order('id', { ascending: false })
    if (nearStartOnly) query = query.gte('captured_at', new Date(Math.min(...times) - 10 * 60_000).toISOString()).lte('captured_at', new Date(Math.max(...times)).toISOString())
    if (decisionAt) query = query.gte('captured_at', new Date(Date.parse(decisionAt) - 2 * 60_000).toISOString()).lte('captured_at', decisionAt)
    const { data, error } = await query.range(offset, offset + 499).abortSignal(AbortSignal.timeout(30000)).retry(false)
    if (error) throw new Error(`Failed to look up PuntersEdge odds snapshots: ${error.message}`)
    snapshotRows.push(...data ?? [])
    if (!data || data.length < 500) break
    if (offset >= 9500) throw new Error('TAB snapshot batch limit reached')
  }

  const startByRunner = new Map<string, string>()
  if (strict) {
    for (const [internalId, peId] of peRaceIdByInternalRaceId) {
      if ([...peRaceIdByInternalRaceId.values()].filter(value => value === peId).length !== 1) continue
      for (const runner of runnerRows ?? []) if (runner.race_id === peId) startByRunner.set(runner.id, races.find(race => race.id === internalId)!.raceDatetime)
    }
  }

  // First occurrence per runner wins - rows are ordered captured_at descending, so that's the latest.
  const latestSnapshotByRunnerId = new Map<string, (typeof snapshotRows)[number]>()
  for (const row of snapshotRows ?? []) {
    const runnerId = row.runner_id as string
    const age = row.tab_age_seconds
    const quotedAt = typeof age === 'number' && Number.isFinite(age) && age >= 0 && age <= 120 && Number.isFinite(Date.parse(row.captured_at)) ? new Date(Date.parse(row.captured_at) - age * 1000).toISOString() : null
    if (nearStartOnly && !isSimulationTabQuote(startByRunner.get(runnerId) ?? '', quotedAt, row.captured_at)) continue
    if (decisionAt && !(timing === 'selection' ? isSimulationSelectionQuote : isSimulationDecisionQuote)(startByRunner.get(runnerId) ?? '', decisionAt, quotedAt, row.captured_at)) continue
    if (!latestSnapshotByRunnerId.has(runnerId)) {
      latestSnapshotByRunnerId.set(runnerId, row)
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
      if (strict && [...runnerNameByRunnerId.values()].filter(name => name === normalizedName).length !== 1) continue
      const snapshot = latestSnapshotByRunnerId.get(runnerId)
      if (!snapshot || (snapshot.tab_win_price == null && snapshot.tab_place_price == null)) continue
      priceByName.set(normalizedName, {
        win: snapshot.tab_win_price ?? undefined,
        place: snapshot.tab_place_price ?? undefined,
        capturedAt: snapshot.captured_at,
        ...(strict ? { quotedAt: new Date(Date.parse(snapshot.captured_at) - snapshot.tab_age_seconds! * 1000).toISOString() } : {}),
      })
    }
    if (priceByName.size > 0) result.set(internalRaceId, priceByName)
  }

  return result
}

export interface FirstTabQuoteRequest extends InternalRaceRef {
  /** The pick already exists from this time; no quote captured earlier is eligible. */
  notBefore: string
}

/**
 * Earliest verified TAB WIN quote per runner on the race's own Melbourne day, captured at or after
 * `notBefore` and before the jump. Used to place Picks History selections at the first moment a
 * real TAB price existed, instead of when the forecast was first published (usually the previous
 * evening or overnight, long before TAB prices exist). The quote must carry a known age of at most
 * 120 seconds and the returned `capturedAt` is the selection time. Nothing later is borrowed.
 */
export async function getFirstTabPricesAfter(admin: SupabaseClient, races: FirstTabQuoteRequest[]): Promise<Map<string, Map<string, TabPrice>>> {
  const result = new Map<string, Map<string, TabPrice>>()
  if (races.length === 0) return result
  if (races.length > 20) throw new Error('Verified TAB lookup is limited to 20 races')
  if (races.some(race => !Number.isFinite(Date.parse(race.notBefore)))) throw new Error('Invalid selection-time TAB lookup')

  const matched = await matchTabRaces(admin, races, true)
  if (!matched) return result
  const { peRaceIdByInternalRaceId, matchedPeRaceIds, runnerRows } = matched
  const peIds = [...peRaceIdByInternalRaceId.values()]
  const raceByRunnerId = new Map<string, FirstTabQuoteRequest>()
  for (const [internalId, peId] of peRaceIdByInternalRaceId) {
    if (peIds.filter(value => value === peId).length !== 1) continue
    for (const runner of runnerRows ?? []) if (runner.race_id === peId) raceByRunnerId.set(runner.id, races.find(race => race.id === internalId)!)
  }

  const earliest = new Map<string, { runner_id: string; tab_win_price: number | null; tab_place_price: number | null; captured_at: string; tab_age_seconds: number }>()
  const from = new Date(Math.min(...races.map(race => Date.parse(race.notBefore)))).toISOString()
  const to = new Date(Math.max(...races.map(race => Date.parse(race.raceDatetime)))).toISOString()
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await admin.from('pe_odds_snapshots')
      .select('id, runner_id, tab_win_price, tab_place_price, captured_at, tab_age_seconds')
      .in('race_id', matchedPeRaceIds).gte('captured_at', from).lte('captured_at', to)
      .order('captured_at', { ascending: true }).order('id', { ascending: true })
      .range(offset, offset + 499).abortSignal(AbortSignal.timeout(30000)).retry(false)
    if (error) throw new Error(`Failed to look up PuntersEdge odds snapshots: ${error.message}`)
    for (const row of data ?? []) {
      const race = raceByRunnerId.get(row.runner_id as string)
      const age = row.tab_age_seconds as number | null
      if (!race || earliest.has(row.runner_id) || typeof age !== 'number' || !(row.tab_win_price > 1)) continue
      const capturedAt = Date.parse(row.captured_at)
      const quotedAt = new Date(capturedAt - age * 1000).toISOString()
      if (capturedAt < Date.parse(race.notBefore) || melbourneDateKey(row.captured_at) !== melbourneDateKey(race.raceDatetime)
        || !isSimulationSelectionQuote(race.raceDatetime, row.captured_at, quotedAt, row.captured_at)) continue
      earliest.set(row.runner_id, row)
    }
    if (!data || data.length < 500) break
    if (offset >= 9500) throw new Error('TAB snapshot batch limit reached')
  }

  for (const [internalRaceId, peId] of peRaceIdByInternalRaceId) {
    const runners = (runnerRows ?? []).filter(runner => runner.race_id === peId)
    const names = runners.map(runner => normalizeHorseName(runner.name as string))
    const priceByName = new Map<string, TabPrice>()
    for (const [index, runner] of runners.entries()) {
      const row = earliest.get(runner.id)
      if (!row || names.filter(name => name === names[index]).length !== 1) continue
      priceByName.set(names[index], {
        win: row.tab_win_price ?? undefined, place: row.tab_place_price ?? undefined, capturedAt: row.captured_at,
        quotedAt: new Date(Date.parse(row.captured_at) - row.tab_age_seconds * 1000).toISOString(),
      })
    }
    if (priceByName.size > 0) result.set(internalRaceId, priceByName)
  }
  return result
}
