import type { SupabaseClient } from '@supabase/supabase-js'
import { getUpcomingRaces } from '@/lib/upcoming-races'
import { loadReliabilityContext } from '@/lib/reliability-context'
import { getDailyPicks, getTomorrowPicks, MIN_WIN_PROBABILITY_FOR_HIGH_CONVICTION, type DailyPick } from '@/lib/daily-picks'
import { recommendedStake, type StakingMethod } from '@/lib/betting/kelly'
import { getOrCreateAccount, placeBet } from '@/lib/paper-betting/repository'

const DEFAULT_STARTING_BANKROLL = 500 // shared 'default' account - matches puntersedge/sync and paper-betting/bets routes

/**
 * Minimum Reliability Score required to auto-place a bet - matches the home page's own
 * "Reliability >= 80" filter toggle, chosen as a defensible high-conviction-only starting point.
 * NOT yet tuned against real settled outcomes (same honesty convention as every other untuned
 * threshold in this codebase - see the tuning register in /memories/repo/racing-predictor-notes.md).
 */
export const MIN_RELIABILITY_FOR_AUTO_BET = 80

export interface ReliabilityAutoBetSummary {
  candidatesConsidered: number
  betsPlaced: number
  skippedNoOdds: number
  skippedZeroStake: number
  skippedDuplicate: number
}

/**
 * Auto-places WIN paper bets (source='internal', mode='AUTO') for today's + tomorrow's picks that
 * qualify via EITHER of two independent gates: the Reliability Score shortlist
 * (MIN_RELIABILITY_FOR_AUTO_BET, matching the home page's "Reliability >= 80" toggle) or the
 * standalone high-conviction win-probability list (MIN_WIN_PROBABILITY_FOR_HIGH_CONVICTION,
 * matching the home page's "Today's/Tomorrow's highest-conviction picks" section). A pick
 * qualifying under both is only ever bet once (deduped by race+horse) so the two gates can never
 * double-stake the same selection.
 * Idempotent per gate: `auto-reliability:{raceId}:{horseId}:WIN` / `auto-probability:{raceId}:
 * {horseId}:WIN` are stable regardless of which day's run first sees a given race (e.g. surfaced
 * as "tomorrow" then again as "today"), so placeBet's unique-key guard makes a repeat run a safe
 * no-op rather than a double stake.
 */
export async function autoPlaceReliabilityBets(admin: SupabaseClient, now = new Date()): Promise<ReliabilityAutoBetSummary> {
  const summary: ReliabilityAutoBetSummary = {
    candidatesConsidered: 0,
    betsPlaced: 0,
    skippedNoOdds: 0,
    skippedZeroStake: 0,
    skippedDuplicate: 0,
  }

  const reliabilityContext = await loadReliabilityContext(admin)
  if (!reliabilityContext) return summary // no published calibration yet - nothing to gate on

  const races = await getUpcomingRaces(admin)
  const reliabilityFilters = { calibration: reliabilityContext.calibration, history: reliabilityContext.history, minReliability: MIN_RELIABILITY_FOR_AUTO_BET }
  const probabilityFilters = { calibration: reliabilityContext.calibration, history: reliabilityContext.history, minWinProbability: MIN_WIN_PROBABILITY_FOR_HIGH_CONVICTION, skipQualificationGate: true }

  const reliabilityPicks = [
    ...getDailyPicks(races, now, Number.MAX_SAFE_INTEGER, reliabilityFilters),
    ...getTomorrowPicks(races, now, Number.MAX_SAFE_INTEGER, reliabilityFilters),
  ]
  const probabilityPicks = [
    ...getDailyPicks(races, now, Number.MAX_SAFE_INTEGER, probabilityFilters),
    ...getTomorrowPicks(races, now, Number.MAX_SAFE_INTEGER, probabilityFilters),
  ]

  const seen = new Set<string>()
  const qualified: { pick: DailyPick; idempotencyPrefix: string }[] = []
  for (const pick of reliabilityPicks) {
    const key = `${pick.race.id}:${pick.horse.horse_id}`
    if (seen.has(key)) continue
    seen.add(key)
    qualified.push({ pick, idempotencyPrefix: 'auto-reliability' })
  }
  for (const pick of probabilityPicks) {
    const key = `${pick.race.id}:${pick.horse.horse_id}`
    if (seen.has(key)) continue
    seen.add(key)
    qualified.push({ pick, idempotencyPrefix: 'auto-probability' })
  }
  if (qualified.length === 0) return summary

  const account = await getOrCreateAccount(admin, 'default', DEFAULT_STARTING_BANKROLL)

  for (const { pick, idempotencyPrefix } of qualified) {
    const minutesToJump = (new Date(pick.race.race_datetime).getTime() - now.getTime()) / 60_000
    if (minutesToJump <= 0) continue // race has already jumped - never a valid new bet

    summary.candidatesConsidered += 1
    const winOdds = pick.horse.win_odds
    if (!winOdds) {
      summary.skippedNoOdds += 1
      continue
    }

    const stake = recommendedStake(account.staking_method as StakingMethod, account.current_bankroll, winOdds, pick.winProbability)
    if (stake <= 0) {
      summary.skippedZeroStake += 1
      continue
    }

    const result = await placeBet(admin, {
      accountId: account.id,
      raceId: pick.race.id,
      runnerId: pick.horse.horse_id,
      runnerName: pick.horse.horse_name,
      category: 'horse',
      source: 'internal',
      mode: 'AUTO',
      betType: 'WIN',
      stake,
      tabDecimalOdds: winOdds,
      modelProbability: pick.winProbability,
      modelVersion: pick.race.prediction?.model_version ?? 'unknown',
      edgePoints: null,
      expectedValue: null,
      confidenceLevel: null, // Reliability classification (e.g. "Excellent") isn't part of PuntersEdge's confidence_level enum - would violate the column's check constraint.
      minutesToJumpAtPlacement: minutesToJump,
      idempotencyKey: `${idempotencyPrefix}:${pick.race.id}:${pick.horse.horse_id}:WIN`,
    })
    if (result.placed) summary.betsPlaced += 1
    else summary.skippedDuplicate += 1
  }

  return summary
}

