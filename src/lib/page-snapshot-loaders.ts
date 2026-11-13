import type { SupabaseClient } from '@supabase/supabase-js'
import { getUpcomingRaces } from './upcoming-races'
import { candidatesForDate, melbourneDateKey } from './daily-picks'
import { loadReliabilityContext } from './reliability-context'
import type { ReliabilityResult } from './reliability-score'
import { queryLatestOpportunities, type OpportunityRow } from './paper-betting/opportunities-query'
import { computeValidationReport } from './paper-betting/validation-query'
import { loadPlaceShadowReport } from './paper-betting/place-shadow'
import { loadDailyPicksHistory } from './daily-picks-history'
import type { Prediction, RaceWithPrediction } from './types'
import { loadResultsSnapshot } from './results-snapshot'
import { loadAccuracySnapshot } from './accuracy-snapshot'
import { loadAnalyticsSnapshot } from './analytics-snapshot'
import { getTabScheduledRaces } from './tab-races'
import { readPaperBonusCredits } from './betting/bonus-back'

export function compactPrediction(prediction: Prediction, primary: boolean): Prediction {
  const payload = prediction.predictions
  const compactHorse = ({ horse_id, horse_name, predicted_position, confidence, win_probability, top3_probability }: Prediction['predictions']['podium'][number]) => ({
    horse_id, horse_name, predicted_position, confidence, win_probability, top3_probability,
  })
  const compact = { ...prediction, actual_results: undefined, predicted_times: {},
    confidence_scores: { overall: prediction.confidence_scores.overall, winner: prediction.confidence_scores.winner } }
  if (!primary) {
    return { ...compact, predictions: { podium: payload.podium.slice(0, 1).map(compactHorse), all_horses: [] } }
  }

  const winnerId = payload.podium[0]?.horse_id
  const winnerSnapshot = winnerId ? payload.feature_snapshots?.[winnerId] : null
  const features = winnerSnapshot && typeof winnerSnapshot === 'object' && !Array.isArray(winnerSnapshot) ? winnerSnapshot.features : null
  const historyStarts = features && typeof features === 'object' && !Array.isArray(features) ? features.historyStarts : 0
  return {
    ...compact,
    predictions: {
      podium: payload.podium,
      all_horses: payload.all_horses.map(compactHorse),
      trifecta: payload.trifecta,
      value_opportunities: payload.value_opportunities?.slice(0, 3),
      place_hedges: payload.place_hedges?.slice(0, 2),
      feature_snapshots: winnerId ? { [winnerId]: { features: { historyStarts: historyStarts ?? 0 } } } : {},
    },
  }
}

export async function loadHomeSnapshot(db: SupabaseClient) {
  const upcomingRaces = await getUpcomingRaces(db, { includeElapsedToday: true })
  const scheduledRaces = await getTabScheduledRaces(upcomingRaces)
  const races = currentSnapshotRaces(scheduledRaces, new Date(), scheduledRaces.map(race => race.id))
  const tabRaceIds = races.map(race => race.id)
  const context = await loadReliabilityContext(db, true)
  const reliabilityByRace: Record<string, ReliabilityResult | null> = {}
  for (const day of new Set(races.map(race => melbourneDateKey(race.race_datetime)))) {
    for (const pick of candidatesForDate(races, day, { ...context, skipQualificationGate: true })) reliabilityByRace[pick.race.id] = pick.reliability
  }
  return {
    races: races.map(race => ({
      ...race,
      prediction: race.prediction ? compactPrediction(race.prediction, true) : null,
      model_predictions: race.model_predictions?.map(model => compactPrediction(model, false)),
    })),
    reliabilityByRace,
    reliabilityAvailable: context !== null,
    tabRaceIds,
  }
}

export function currentSnapshotRaces(races: RaceWithPrediction[], now = new Date(), tabRaceIds: readonly string[] = []) {
  const today = melbourneDateKey(now)
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const tabRaces = new Set(tabRaceIds)
  return races.filter(race => tabRaces.has(race.id) && race.status === 'upcoming' && Date.parse(race.race_datetime) > now.getTime()
    && melbourneDateKey(race.race_datetime) <= tomorrow)
}

export function currentSnapshotOpportunities(rows: OpportunityRow[], now = new Date()) {
  return rows.filter(row => {
    const race = Array.isArray(row.pe_races) ? row.pe_races[0] : row.pe_races
    const age = now.getTime() - Date.parse(row.generated_at)
    return race && Date.parse(race.start_time) > now.getTime() && age >= 0 && age <= 30 * 60_000
  })
}

export async function loadValidationSnapshot(db: SupabaseClient) {
  const account = await db.from('paper_accounts').select('id').eq('name', 'default').maybeSingle()
  if (account.error) throw account.error
  return { accountId: account.data?.id ?? null, report: account.data ? await computeValidationReport(db, account.data.id) : null,
    bonusCredits: account.data ? await readPaperBonusCredits(db, account.data.id) : [] }
}

export async function loadPicksHistorySnapshot(db: SupabaseClient) {
  return loadDailyPicksHistory(db, { days: 7 })
}

export const pageLoaders = {
  home: loadHomeSnapshot,
  opportunities: (db: SupabaseClient) => queryLatestOpportunities(db),
  validation: loadValidationSnapshot,
  'place-shadow': loadPlaceShadowReport,
  'picks-history': loadPicksHistorySnapshot,
  results: loadResultsSnapshot,
  accuracy: loadAccuracySnapshot,
  analytics: loadAnalyticsSnapshot,
}

export type HomeSnapshot = Awaited<ReturnType<typeof loadHomeSnapshot>>