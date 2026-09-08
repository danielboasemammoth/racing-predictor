import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPuntersEdgeClient, PuntersEdgeCreditsExhaustedError, type PuntersEdgeClient } from '@/lib/puntersedge/client'
import {
  generateRaceRecommendations,
  GREYHOUND_FUNDAMENTALS_HYBRID_MODEL_VERSION,
  MARKET_CONSENSUS_MODEL_VERSION,
  MARKET_FUNDAMENTALS_HYBRID_MODEL_VERSION,
} from '@/lib/paper-betting/generate-recommendations'
import { DEFAULT_THRESHOLDS } from '@/lib/betting/recommendation-engine'
import { recommendedStake } from '@/lib/betting/kelly'
import {
  findGreyhoundFundamentalsMatch,
  findHorseFundamentalsMatch,
  getLatestApiUsage,
  getOrCreateAccount,
  insertOddsSnapshots,
  insertRecommendations,
  placeBet,
  recordApiUsage,
  upsertRaceAndRunners,
  type PaperAccountRow,
} from '@/lib/paper-betting/repository'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PeNextToGoRace, RacingCategory } from '@/lib/puntersedge/types'

const DEFAULT_STARTING_BANKROLL = 500
// Below this, stop spending credits on next-to-go (2/call) - reserve what's left for settling
// bets that are already placed, which matters more than discovering new ones.
const MIN_CREDITS_RESERVE = 20

// Greyhound form+stats cost 3cr each (6cr/dog) - fetching every runner in every priced greyhound
// race would burn the whole monthly budget in a single poll (verified live: 257 distinct dogs
// priced at once = ~1,542cr, more than a full month on the free tier). Two guardrails keep this
// sustainable instead: only bother for races close enough to jump that a bet could actually fire,
// and cap new (not-yet-cached) fetches per sync run so cost is spread across many polls rather
// than spent all at once - a 14-day cache TTL (see repository.ts) means the "backlog" of distinct
// AU dogs gets covered gradually, not instantly.
// DISABLED 2026-09-08: live settled results showed this model performing dramatically worse than
// the market-consensus baseline it's blended with, and worse than the horse fundamentals model
// (identical blend architecture) - greyhound PLACE bets off this model were -73% to -82% ROI at a
// 4% win rate against an implied breakeven of ~13% (avg odds ~$7.80), and greyhound WIN bets were
// 0-for-6+. That gap, isolated to this one model while the shared framework (thresholds, blend
// weight, maxOdds) performs fine for horses, points at a calibration problem in the greyhound
// score itself (recent-form/box-fit weights), not the betting logic - see the 2026-09-08 entry in
// /memories/repo/racing-predictor-notes.md before re-enabling. Falling back to market-consensus-v1
// for greyhound (same as before this model existed) until it's investigated further.
const ENABLE_GREYHOUND_FUNDAMENTALS = false
const GREYHOUND_FUNDAMENTALS_MAX_MINUTES_TO_JUMP = 90
const GREYHOUND_FUNDAMENTALS_MAX_NEW_FETCHES_PER_SYNC = 10

/** Per-race unit of work for POST's batched loop - upserts, snapshots recs, and auto-places bets for one race. */
async function processRace(
  admin: SupabaseClient,
  client: PuntersEdgeClient,
  account: PaperAccountRow,
  race: PeNextToGoRace,
  now: Date,
  greyhoundFetchBudget: { remaining: number },
) {
  let betsCreated = 0
  let watchCount = 0
  let noBetCount = 0

  const minutesToJump = (new Date(race.start_time).getTime() - now.getTime()) / 60_000
  const runnerIdByNumber = await upsertRaceAndRunners(admin, race, minutesToJump <= 0 ? 'started' : 'upcoming')

  let fundamentalsProbabilityByRunnerNumber: Map<number, number> | null = null
  let modelVersion = MARKET_CONSENSUS_MODEL_VERSION
  if (race.category === 'horse') {
    fundamentalsProbabilityByRunnerNumber = await findHorseFundamentalsMatch(admin, race)
    if (fundamentalsProbabilityByRunnerNumber) modelVersion = MARKET_FUNDAMENTALS_HYBRID_MODEL_VERSION
  } else if (ENABLE_GREYHOUND_FUNDAMENTALS && race.category === 'greyhound' && minutesToJump > 0 && minutesToJump <= GREYHOUND_FUNDAMENTALS_MAX_MINUTES_TO_JUMP) {
    fundamentalsProbabilityByRunnerNumber = await findGreyhoundFundamentalsMatch(admin, client, race, greyhoundFetchBudget)
    if (fundamentalsProbabilityByRunnerNumber) modelVersion = GREYHOUND_FUNDAMENTALS_HYBRID_MODEL_VERSION
  }
  const recommendations = generateRaceRecommendations(race, { now, fundamentalsProbabilityByRunnerNumber: fundamentalsProbabilityByRunnerNumber ?? undefined })

  await insertOddsSnapshots(admin, race.race_id, recommendations, runnerIdByNumber, minutesToJump)
  await insertRecommendations(admin, race.race_id, race.category, modelVersion, DEFAULT_THRESHOLDS, recommendations, runnerIdByNumber, minutesToJump)

  for (const rec of recommendations) {
    if (rec.decision === 'WATCH') watchCount += 1
    if (rec.decision === 'NO_BET') noBetCount += 1

    const runnerId = runnerIdByNumber.get(rec.runnerNumber)
    if (!runnerId) continue

    if (rec.decision === 'BET' && rec.tabWinPrice != null && rec.modelProbability != null) {
      const stake = recommendedStake(account.staking_method as Parameters<typeof recommendedStake>[0], account.current_bankroll, rec.tabWinPrice, rec.modelProbability)
      if (stake > 0) {
        const result = await placeBet(admin, {
          accountId: account.id,
          raceId: race.race_id,
          runnerId,
          runnerName: rec.runnerName,
          category: race.category,
          source: 'puntersedge',
          mode: 'AUTO',
          betType: 'WIN',
          stake,
          tabDecimalOdds: rec.tabWinPrice,
          modelProbability: rec.modelProbability,
          modelVersion,
          edgePoints: rec.edgePoints,
          expectedValue: rec.expectedValueRatio,
          confidenceLevel: rec.confidenceLevel,
          minutesToJumpAtPlacement: minutesToJump,
          // Deliberately NOT model-version-scoped - a race whose fundamentals match only becomes
          // available partway through the day (once the internal prediction is generated) must
          // never place a second bet on the same runner just because modelVersion changed.
          idempotencyKey: `auto:${race.race_id}:${rec.runnerNumber}:WIN`,
        })
        if (result.placed) betsCreated += 1
      }
    }

    // Harville-derived place edge - separate qualifying decision from the win bet above.
    if (rec.place?.decision === 'BET' && rec.tabPlacePrice != null) {
      const placeStake = recommendedStake(account.staking_method as Parameters<typeof recommendedStake>[0], account.current_bankroll, rec.tabPlacePrice, rec.place.modelProbability)
      if (placeStake > 0) {
        const result = await placeBet(admin, {
          accountId: account.id,
          raceId: race.race_id,
          runnerId,
          runnerName: rec.runnerName,
          category: race.category,
          source: 'puntersedge',
          mode: 'AUTO',
          betType: 'PLACE',
          stake: placeStake,
          tabDecimalOdds: rec.tabPlacePrice,
          modelProbability: rec.place.modelProbability,
          modelVersion,
          edgePoints: rec.place.edgePoints,
          expectedValue: rec.place.expectedValueRatio,
          confidenceLevel: rec.confidenceLevel,
          minutesToJumpAtPlacement: minutesToJump,
          idempotencyKey: `auto:${race.race_id}:${rec.runnerNumber}:PLACE`,
        })
        if (result.placed) betsCreated += 1
      }
    }
  }

  return { betsCreated, watchCount, noBetCount }
}

/**
 * Fetches the currently priced card from PuntersEdge, upserts races/runners, generates
 * BET/WATCH/NO_BET recommendations via the market-consensus baseline model (blended with the
 * internal Racing.com horse fundamentals model when a matching internal race is found - see
 * findHorseFundamentalsMatch), stores an immutable odds snapshot + recommendation row per runner,
 * and auto-places a paper bet for every BET decision on the default account (idempotency_key
 * dedupes re-syncs of the same runner/race).
 */
export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  let categories: RacingCategory[] = ['horse', 'greyhound', 'harness']
  try {
    const body: unknown = await request.json().catch(() => ({}))
    if (typeof body === 'object' && body !== null && 'categories' in body && Array.isArray((body as { categories: unknown }).categories)) {
      categories = (body as { categories: RacingCategory[] }).categories
    }
  } catch {
    // no body / invalid JSON - use the default of all three codes
  }

  const admin = createAdminClient()
  const client = getPuntersEdgeClient()
  const now = new Date()

  try {
    const usage = await getLatestApiUsage(admin)
    if (usage && usage.creditsRemaining < MIN_CREDITS_RESERVE) {
      return NextResponse.json({
        success: true,
        racesProcessed: 0,
        betsCreated: 0,
        watchCount: 0,
        noBetCount: 0,
        skippedLowCredits: true,
        message: `Skipped sync - only ${usage.creditsRemaining} PuntersEdge credits remaining this period (reserve threshold ${MIN_CREDITS_RESERVE})`,
      })
    }

    const races = await client.nextToGo({ numRaces: 200, categories, country: ['AU'], includeUnresolved: true })
    const account = await getOrCreateAccount(admin, 'default', DEFAULT_STARTING_BANKROLL)
    const greyhoundFetchBudget = { remaining: GREYHOUND_FUNDAMENTALS_MAX_NEW_FETCHES_PER_SYNC }

    let racesProcessed = 0
    let betsCreated = 0
    let watchCount = 0
    let noBetCount = 0

    // Each race's DB writes are independent, but were previously awaited fully sequentially -
    // wall-clock time scaled linearly with race count (4+ round trips/race) and started exceeding
    // the poller's fixed timeout once ~100+ races were concurrently priced (mid-morning meeting
    // overlap). Process in bounded-concurrency batches instead so total time approaches one
    // batch's latency rather than the sum of every race's latency.
    const RACE_CONCURRENCY = 10
    for (let i = 0; i < races.length; i += RACE_CONCURRENCY) {
      const batch = races.slice(i, i + RACE_CONCURRENCY)
      const results = await Promise.all(batch.map((race) => processRace(admin, client, account, race, now, greyhoundFetchBudget)))
      for (const result of results) {
        racesProcessed += 1
        betsCreated += result.betsCreated
        watchCount += result.watchCount
        noBetCount += result.noBetCount
      }
    }

    try {
      const usage = await client.usage()
      await recordApiUsage(admin, usage)
    } catch {
      // Usage tracking is best-effort (requires a real key) - never fail the sync because of it.
    }

    return NextResponse.json({
      success: true,
      racesProcessed,
      betsCreated,
      watchCount,
      noBetCount,
      demoMode: client.isDemoMode,
      updatedAt: now.toISOString(),
      message: `Processed ${racesProcessed} race${racesProcessed === 1 ? '' : 's'}${client.isDemoMode ? ' (sandbox demo data - no PUNTERSEDGE_API_KEY configured)' : ''}: ${betsCreated} auto paper bet${betsCreated === 1 ? '' : 's'} placed, ${watchCount} watch, ${noBetCount} no-bet`,
    })
  } catch (error) {
    if (error instanceof PuntersEdgeCreditsExhaustedError) {
      return NextResponse.json({ success: false, message: 'PuntersEdge monthly credit allowance is exhausted - try again after the reset.' }, { status: 402 })
    }
    console.error('PuntersEdge sync failed', error)
    return NextResponse.json({ success: false, message: 'PuntersEdge sync failed' }, { status: 500 })
  }
}
