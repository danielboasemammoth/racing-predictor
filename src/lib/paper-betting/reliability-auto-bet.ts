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

const DEFAULT_STARTING_BANKROLL = 500 // shared 'default' account - matches puntersedge/sync and paper-betting/bets routes

/**
 * Minimum Reliability Score required to auto-place a bet - matches the home page's own
 * "Reliability >= 80" filter toggle, chosen as a defensible high-conviction-only starting point.
 * NOT yet tuned against real settled outcomes (same honesty convention as every other untuned
 * threshold in this codebase - see the tuning register in /memories/repo/racing-predictor-notes.md).
 */
export const MIN_RELIABILITY_FOR_AUTO_BET = 80
export const MIN_PLACE_PROBABILITY_FOR_AUTO_BET = 0.6

export function internalValueCandidates(race: RaceWithPrediction, activeHorseIds: Set<string>, winHorseId?: string) {
  const horses = race.prediction?.predictions.all_horses ?? []
  const completeField = horses.length === activeHorseIds.size
    && new Set(horses.map((horse) => horse.horse_id)).size === activeHorseIds.size
    && horses.every((horse) => activeHorseIds.has(horse.horse_id))
  const candidates: Array<{ horse: PredictedHorse; betType: 'WIN' | 'PLACE'; odds: number; probability: number; edge: number; ev: number }> = []
  if (!completeField) return candidates

  for (const horse of horses) {
    for (const betType of ['WIN', 'PLACE'] as const) {
      if (betType === 'WIN' && horse.horse_id !== winHorseId) continue
      if (betType === 'PLACE' && paidPlacesCount('horse', activeHorseIds.size) !== 3) continue
      const odds = betType === 'WIN' ? horse.win_odds : horse.place_odds
      const probability = betType === 'WIN' ? horse.win_probability : horse.top3_probability
      if (odds == null || !Number.isFinite(odds) || odds <= 1 || odds > DEFAULT_THRESHOLDS.maxOdds) continue
      if (probability == null || !Number.isFinite(probability) || probability <= 0 || probability >= 1) continue
      if (betType === 'PLACE' && probability < MIN_PLACE_PROBABILITY_FOR_AUTO_BET) continue
      const edge = probabilityEdgePoints(probability, odds)
      const ev = expectedValue(probability, odds)
      if (edge < DEFAULT_THRESHOLDS.minEdgePoints || ev <= 0) continue
      candidates.push({ horse, betType, odds, probability, edge, ev })
    }
  }
  return candidates.sort((left, right) => right.probability - left.probability || right.ev - left.ev)
}

export interface ReliabilityAutoBetSummary {
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
    if (!Number.isFinite(minutesToJump) || minutesToJump < DEFAULT_THRESHOLDS.minMinutesToJump || minutesToJump > DEFAULT_THRESHOLDS.maxMinutesToJump) continue
    if (race.status !== 'upcoming' || !race.prediction || race.prediction.model_version.includes('retrospective')) continue
    const predictionTime = Date.parse(race.prediction.predicted_at)
    if (!Number.isFinite(predictionTime) || predictionTime > now.getTime()) continue
    const entries = await admin.from('race_entries').select('horse_id, status').eq('race_id', race.id)
    if (entries.error) throw entries.error
    const activeHorseIds = new Set<string>((entries.data ?? []).filter((entry) => entry.status !== 'scratched').map((entry) => entry.horse_id))
    const candidates = internalValueCandidates(race, activeHorseIds, qualifiedWinners.get(race.id))
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

  return summary
}

