import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPuntersEdgeClient, PuntersEdgeCreditsExhaustedError } from '@/lib/puntersedge/client'
import { generateRaceRecommendations, MARKET_CONSENSUS_MODEL_VERSION } from '@/lib/paper-betting/generate-recommendations'
import { DEFAULT_THRESHOLDS } from '@/lib/betting/recommendation-engine'
import { recommendedStake } from '@/lib/betting/kelly'
import {
  getLatestApiUsage,
  getOrCreateAccount,
  insertOddsSnapshots,
  insertRecommendations,
  placeBet,
  recordApiUsage,
  upsertRaceAndRunners,
} from '@/lib/paper-betting/repository'
import type { RacingCategory } from '@/lib/puntersedge/types'

const DEFAULT_STARTING_BANKROLL = 500
// Below this, stop spending credits on next-to-go (2/call) - reserve what's left for settling
// bets that are already placed, which matters more than discovering new ones.
const MIN_CREDITS_RESERVE = 20

/**
 * Fetches the currently priced card from PuntersEdge, upserts races/runners, generates
 * BET/WATCH/NO_BET recommendations via the market-consensus baseline model, stores an immutable
 * odds snapshot + recommendation row per runner, and auto-places a paper bet for every BET
 * decision on the default account (idempotency_key dedupes re-syncs of the same runner/race).
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

    let racesProcessed = 0
    let betsCreated = 0
    let watchCount = 0
    let noBetCount = 0

    for (const race of races) {
      const minutesToJump = (new Date(race.start_time).getTime() - now.getTime()) / 60_000
      const runnerIdByNumber = await upsertRaceAndRunners(admin, race, minutesToJump <= 0 ? 'started' : 'upcoming')
      const recommendations = generateRaceRecommendations(race, { now })

      await insertOddsSnapshots(admin, race.race_id, recommendations, runnerIdByNumber, minutesToJump)
      await insertRecommendations(admin, race.race_id, race.category, MARKET_CONSENSUS_MODEL_VERSION, DEFAULT_THRESHOLDS, recommendations, runnerIdByNumber, minutesToJump)
      racesProcessed += 1

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
              mode: 'AUTO',
              betType: 'WIN',
              stake,
              tabDecimalOdds: rec.tabWinPrice,
              modelProbability: rec.modelProbability,
              modelVersion: MARKET_CONSENSUS_MODEL_VERSION,
              edgePoints: rec.edgePoints,
              expectedValue: rec.expectedValueRatio,
              confidenceLevel: rec.confidenceLevel,
              minutesToJumpAtPlacement: minutesToJump,
              idempotencyKey: `auto:${race.race_id}:${rec.runnerNumber}:WIN:${MARKET_CONSENSUS_MODEL_VERSION}`,
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
              mode: 'AUTO',
              betType: 'PLACE',
              stake: placeStake,
              tabDecimalOdds: rec.tabPlacePrice,
              modelProbability: rec.place.modelProbability,
              modelVersion: MARKET_CONSENSUS_MODEL_VERSION,
              edgePoints: rec.place.edgePoints,
              expectedValue: rec.place.expectedValueRatio,
              confidenceLevel: rec.confidenceLevel,
              minutesToJumpAtPlacement: minutesToJump,
              idempotencyKey: `auto:${race.race_id}:${rec.runnerNumber}:PLACE:${MARKET_CONSENSUS_MODEL_VERSION}`,
            })
            if (result.placed) betsCreated += 1
          }
        }
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
