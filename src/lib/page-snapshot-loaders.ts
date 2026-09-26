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
import { getTabRaceIds } from './tab-races'

function compactPrediction(prediction: Prediction, primary: boolean): Prediction {
  const payload = prediction.predictions
  return {
    ...prediction, actual_results: undefined, predicted_times: {},
    predictions: primary ? {
      ...payload,
      feature_snapshots: Object.fromEntries(Object.entries(payload.feature_snapshots ?? {}).map(([horseId, snapshot]) => {
        const features = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot.features : null
        const starts = features && typeof features === 'object' && !Array.isArray(features) ? features.historyStarts : 0
        return [horseId, { features: { historyStarts: starts ?? 0 } }]
      })),
    } : { podium: payload.podium.slice(0, 1), all_horses: [] },
  }
}

export async function loadHomeSnapshot(db: SupabaseClient) {
  const upcomingRaces = await getUpcomingRaces(db)
  const tabRaceIds = await getTabRaceIds(upcomingRaces)
  const tabRaces = new Set(tabRaceIds)
  const races = upcomingRaces.filter(race => tabRaces.has(race.id))
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
  return { accountId: account.data?.id ?? null, report: account.data ? await computeValidationReport(db, account.data.id) : null }
}

export async function loadPicksHistorySnapshot(db: SupabaseClient) {
  const context = await loadReliabilityContext(db, true)
  if (!context) throw new Error('Reliability context not yet available')
  return loadDailyPicksHistory(db, { ...context, days: 7 })
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