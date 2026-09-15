import type { SupabaseClient } from '@supabase/supabase-js'
import { getUpcomingRaces } from '@/lib/upcoming-races'
import { loadReliabilityContext } from '@/lib/reliability-context'
import { getDailyPicks, getTomorrowPicks } from '@/lib/daily-picks'
import { recommendedStake, type StakingMethod } from '@/lib/betting/kelly'
import { getOrCreateAccount, placeBet } from '@/lib/paper-betting/repository'
import { expectedValue, probabilityEdgePoints } from '@/lib/betting/odds-math'
import { DEFAULT_THRESHOLDS } from '@/lib/betting/recommendation-engine'
import { paidPlacesCount } from '@/lib/betting/place-rules'
import type { PredictedHorse, RaceWithPrediction } from '@/lib/types'
import { INTERNAL_VALUE_POLICY_VERSION, supportsPolicyTracking } from './policy-tracking'

const DEFAULT_STARTING_BANKROLL = 500 // shared 'default' account - matches puntersedge/sync and paper-betting/bets routes

/**
 * Minimum Reliability Score required to auto-place a bet - matches the home page's own
 * "Reliability >= 80" filter toggle, chosen as a defensible high-conviction-only starting point.
 * NOT yet tuned against real settled outcomes (same honesty convention as every other untuned
 * threshold in this codebase - see the tuning register in /memories/repo/racing-predictor-notes.md).
 */
export const MIN_RELIABILITY_FOR_AUTO_BET = 80
export const MIN_PLACE_PROBABILITY_FOR_AUTO_BET = 0.6

type RejectionReason = 'field_mismatch' | 'win_reliability' | 'unsupported_place_market' | 'invalid_odds' | 'odds_cap' | 'invalid_probability' | 'place_chance' | 'nonpositive_ev' | 'edge_floor'

export function evaluateInternalValueCandidates(race: RaceWithPrediction, activeHorseIds: Set<string>, winHorseId?: string) {
  const rejected: Record<RejectionReason, number> = {
    field_mismatch: 0, win_reliability: 0, unsupported_place_market: 0,
    invalid_odds: 0, odds_cap: 0, invalid_probability: 0, place_chance: 0,
    nonpositive_ev: 0, edge_floor: 0,
  }

  const horses = race.prediction?.predictions.all_horses ?? []
  const completeField = horses.length === activeHorseIds.size
    && new Set(horses.map((horse) => horse.horse_id)).size === activeHorseIds.size
    && horses.every((horse) => activeHorseIds.has(horse.horse_id))
  const candidates: Array<{ horse: PredictedHorse; betType: 'WIN' | 'PLACE'; odds: number; probability: number; edge: number; ev: number }> = []
  if (!completeField) {
    rejected.field_mismatch = horses.length * 2
    return { candidates, rejected, marketsConsidered: horses.length * 2 }
  }

  for (const horse of horses) {
    for (const betType of ['WIN', 'PLACE'] as const) {
      if (betType === 'WIN' && horse.horse_id !== winHorseId) { rejected.win_reliability += 1; continue }
      if (betType === 'PLACE' && paidPlacesCount('horse', activeHorseIds.size) !== 3) { rejected.unsupported_place_market += 1; continue }
      const odds = betType === 'WIN' ? horse.win_odds : horse.place_odds
      const probability = betType === 'WIN' ? horse.win_probability : horse.top3_probability
      if (odds == null || !Number.isFinite(odds) || odds <= 1) { rejected.invalid_odds += 1; continue }
      if (odds > DEFAULT_THRESHOLDS.maxOdds) { rejected.odds_cap += 1; continue }
      if (probability == null || !Number.isFinite(probability) || probability <= 0 || probability >= 1) { rejected.invalid_probability += 1; continue }
      if (betType === 'PLACE' && probability < MIN_PLACE_PROBABILITY_FOR_AUTO_BET) { rejected.place_chance += 1; continue }
      const edge = probabilityEdgePoints(probability, odds)
      const ev = expectedValue(probability, odds)
      if (ev <= 0) { rejected.nonpositive_ev += 1; continue }
      if (edge < DEFAULT_THRESHOLDS.minEdgePoints) { rejected.edge_floor += 1; continue }
      candidates.push({ horse, betType, odds, probability, edge, ev })
    }
  }
  candidates.sort((left, right) => right.probability - left.probability || right.ev - left.ev)
  return { candidates, rejected, marketsConsidered: horses.length * 2 }
}

export function internalValueCandidates(race: RaceWithPrediction, activeHorseIds: Set<string>, winHorseId?: string) {
  return evaluateInternalValueCandidates(race, activeHorseIds, winHorseId).candidates
}

export interface ReliabilityAutoBetSummary {
  policyVersion: string
  policyTrackingAvailable: boolean
  marketsConsidered: number
  rejectionCounts: Record<string, number>
  raceSkips: { outsideWindow: number; invalidPrediction: number }
  candidatesConsidered: number
  betsPlaced: number
  winBetsPlaced: number
  placeBetsPlaced: number
  skippedNoOdds: number
  skippedZeroStake: number
  skippedDuplicate: number
}

export async function autoPlaceReliabilityBets(admin: SupabaseClient, now = new Date()): Promise<ReliabilityAutoBetSummary> {
  const summary: ReliabilityAutoBetSummary = {
    policyVersion: INTERNAL_VALUE_POLICY_VERSION,
    policyTrackingAvailable: await supportsPolicyTracking(admin),
    marketsConsidered: 0,
    rejectionCounts: {},
    raceSkips: { outsideWindow: 0, invalidPrediction: 0 },
    candidatesConsidered: 0,
    betsPlaced: 0,
    winBetsPlaced: 0,
    placeBetsPlaced: 0,
    skippedNoOdds: 0,
    skippedZeroStake: 0,
    skippedDuplicate: 0,
  }

  const reliabilityContext = await loadReliabilityContext(admin)
  const races = await getUpcomingRaces(admin)
  const reliabilityFilters = { calibration: reliabilityContext?.calibration, history: reliabilityContext?.history, minReliability: MIN_RELIABILITY_FOR_AUTO_BET }

  const qualified = [
    ...getDailyPicks(races, now, Number.MAX_SAFE_INTEGER, reliabilityFilters),
    ...getTomorrowPicks(races, now, Number.MAX_SAFE_INTEGER, reliabilityFilters),
  ]
  const qualifiedWinners = new Map(qualified.map((pick) => [pick.race.id, pick.horse.horse_id]))

  for (const race of races) {
    const minutesToJump = (new Date(race.race_datetime).getTime() - now.getTime()) / 60_000
    if (!Number.isFinite(minutesToJump) || minutesToJump < DEFAULT_THRESHOLDS.minMinutesToJump || minutesToJump > DEFAULT_THRESHOLDS.maxMinutesToJump) { summary.raceSkips.outsideWindow += 1; continue }
    if (race.status !== 'upcoming' || !race.prediction || race.prediction.model_version.includes('retrospective')) { summary.raceSkips.invalidPrediction += 1; continue }
    const predictionTime = Date.parse(race.prediction.predicted_at)
    if (!Number.isFinite(predictionTime) || predictionTime > now.getTime()) { summary.raceSkips.invalidPrediction += 1; continue }
    const entries = await admin.from('race_entries').select('horse_id, status').eq('race_id', race.id)
    if (entries.error) throw entries.error
    const activeHorseIds = new Set<string>((entries.data ?? []).filter((entry) => entry.status !== 'scratched').map((entry) => entry.horse_id))
    const { candidates, rejected, marketsConsidered } = evaluateInternalValueCandidates(race, activeHorseIds, qualifiedWinners.get(race.id))
    summary.marketsConsidered += marketsConsidered
    for (const [reason, count] of Object.entries(rejected)) summary.rejectionCounts[reason] = (summary.rejectionCounts[reason] ?? 0) + count
    summary.candidatesConsidered += race.prediction.predictions.all_horses.length
    summary.skippedNoOdds += race.prediction.predictions.all_horses.filter((horse) => !horse.win_odds && !horse.place_odds).length

    for (const candidate of candidates) {
      const account = await getOrCreateAccount(admin, 'default', DEFAULT_STARTING_BANKROLL)
      const stake = recommendedStake(account.staking_method as StakingMethod, account.current_bankroll, candidate.odds, candidate.probability)
      if (stake <= 0) {
        summary.skippedZeroStake += 1
        continue
      }

      const result = await placeBet(admin, {
        accountId: account.id,
        raceId: race.id,
        runnerId: candidate.horse.horse_id,
        runnerName: candidate.horse.horse_name,
        category: 'horse',
        source: 'internal',
        mode: 'AUTO',
        betType: candidate.betType,
        stake,
        tabDecimalOdds: candidate.odds,
        modelProbability: candidate.probability,
        modelVersion: race.prediction.model_version,
        ...(summary.policyTrackingAvailable ? { policyVersion: INTERNAL_VALUE_POLICY_VERSION } : {}),
        edgePoints: candidate.edge,
        expectedValue: candidate.ev,
        confidenceLevel: null,
        minutesToJumpAtPlacement: minutesToJump,
        idempotencyKey: `auto-reliability:${race.id}:${candidate.horse.horse_id}:${candidate.betType}`,
      })
      if (result.placed) {
        summary.betsPlaced += 1
        if (candidate.betType === 'PLACE') summary.placeBetsPlaced += 1
        else summary.winBetsPlaced += 1
      }
      else summary.skippedDuplicate += 1
    }
  }

  const snapshot = await admin.from('analysis_snapshots').upsert({
    kind: 'paper-policy-latest-run',
    payload: summary,
    generated_at: now.toISOString(),
  }, { onConflict: 'kind' })
  if (snapshot.error) throw snapshot.error
  return summary
}

