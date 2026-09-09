import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { evaluatePrediction, type ActualRaceEntry } from '@/lib/backtest'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Prediction, PredictionPayload } from '@/lib/types'

interface CompletedRace {
  id: string
  race_datetime: string
}

type PredictionMeta = Pick<Prediction, 'id' | 'race_id' | 'model_version' | 'predicted_at' | 'confidence_scores'>
// Every completed race's predictions were being re-fetched AND re-scored from scratch on every
// single run, forever - this table only grows (predictions are insert-only, see
// /memories/repo/racing-predictor.md), so this route's cost scaled with the TOTAL historical
// dataset rather than with "races newly completed since the last run", exactly the same class of
// bug already fixed once for /api/admin/predict's retrospective mode (2026-09-06) but never
// applied here. Combined with selecting the full `predictions` jsonb payload (podium/all_horses/
// feature_snapshots/model_components - feature_snapshots alone dominates row size, see the
// DB-size investigation note), this made the route take ~4 minutes and fail with a Supabase/
// Cloudflare 520, which aborted the whole nightly pipeline before it ever reached the newer
// "Refresh Reliability Calibration" step - found + fixed 2026-09-10.
//
// Fix: predictions are now fetched in two shapes depending on whether they're already scored.
// UNSCORED rows (actual_results IS NULL - normally just a handful of newly-completed races' worth)
// get the full fields evaluatePrediction() needs (podium, all_horses, predicted_times) and get
// freshly computed + written. Already-SCORED rows (the bulk of the table) only need a few tiny
// fields (podium - NOT all_horses - plus the already-stored actual_results) to fold into the
// cumulative accuracy_log/metrics totals below, without ever re-computing or re-writing them.
interface UnscoredPredictionRow extends PredictionMeta {
  predicted_times: Record<string, number>
  podium: PredictionPayload['podium'] | null
  all_horses: PredictionPayload['all_horses'] | null
}
interface ScoredPredictionRow extends Omit<PredictionMeta, 'id'> {
  podium: PredictionPayload['podium'] | null
  actual_results: {
    podium?: string[]
    winner_top3?: boolean
    podium_overlap?: number
    ordered_trifecta?: boolean
    winner_brier_score?: number
    winner_log_loss?: number
  }
}

interface ModelOutcome {
  date: string
  correctWinner: boolean
  correctPodium: boolean
  confidence: number
  timeErrors: number[]
  winnerTop3: boolean
  podiumOverlap: number
  orderedTrifecta: boolean
  winnerBrierScore: number
  winnerLogLoss: number
}

/** Reconstructs the same shape evaluatePrediction() would have produced, from already-stored actual_results + the (small) predicted podium - no full-field data or recomputation needed. */
function outcomeFromStoredResult(row: ScoredPredictionRow, raceDate: string): ModelOutcome | null {
  const predictedPodium = (row.podium ?? []).map((horse) => horse.horse_id)
  const actualPodium = row.actual_results.podium ?? []
  if (!predictedPodium.length || !actualPodium.length) return null
  const correctWinner = predictedPodium[0] === actualPodium[0]
  const correctPodium = actualPodium.length === 3 && predictedPodium.length === 3
    && actualPodium.every((horseId) => predictedPodium.includes(horseId))
  return {
    date: raceDate,
    correctWinner,
    correctPodium,
    confidence: row.confidence_scores.overall,
    timeErrors: [], // not stored on actual_results - only newly-scored races (below) contribute to avg_time_error
    winnerTop3: row.actual_results.winner_top3 ?? false,
    podiumOverlap: row.actual_results.podium_overlap ?? 0,
    orderedTrifecta: row.actual_results.ordered_trifecta ?? false,
    winnerBrierScore: row.actual_results.winner_brier_score ?? 0,
    winnerLogLoss: row.actual_results.winner_log_loss ?? 0,
  }
}

export async function POST() {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const races: CompletedRace[] = []
    const pageSize = 1_000
    for (let offset = 0; ; offset += pageSize) {
      const { data: racePage, error: racesError } = await supabase
        .from('races')
        .select('id, race_datetime')
        .eq('status', 'completed')
        .order('race_datetime', { ascending: false })
        .range(offset, offset + pageSize - 1)
      if (racesError) throw racesError
      races.push(...((racePage ?? []) as CompletedRace[]))
      if (!racePage || racePage.length < pageSize) break
    }
    if (!races.length) {
      return NextResponse.json({ success: false, message: 'No completed races to backtest' }, { status: 404 })
    }

    const raceIds = races.map((race) => race.id)
    const entriesData: ActualRaceEntry[] & Array<{ race_id: string }> = []
    const unscoredData: (UnscoredPredictionRow & { race_id: string })[] = []
    const scoredData: (ScoredPredictionRow & { race_id: string })[] = []
    const unscoredNeedsFullFetch: Array<PredictionMeta & { race_id: string; podium: PredictionPayload['podium'] | null }> = []
    const raceChunkSize = 100
    const chunks: string[][] = []
    for (let offset = 0; offset < raceIds.length; offset += raceChunkSize) {
      chunks.push(raceIds.slice(offset, offset + raceChunkSize))
    }
    // Chunks are fetched in small concurrent BATCHES, not one at a time - fully sequential chunk
    // fetching (the original pattern) was another contributor to this route's slow runtime once
    // the historical dataset grew large (fixed 2026-09-10, same pattern already applied to
    // daily-picks-history.ts on 2026-09-09).
    const CONCURRENT_CHUNK_BATCH = 4
    for (let i = 0; i < chunks.length; i += CONCURRENT_CHUNK_BATCH) {
      const batch = chunks.slice(i, i + CONCURRENT_CHUNK_BATCH)
      const batchResults = await Promise.all(batch.map((chunk) => Promise.all([
        supabase
          .from('race_entries')
          .select('race_id, horse_id, finishing_position, finishing_time')
          .in('race_id', chunk),
        // Deliberately NOT filtered by actual_results IS [NOT] NULL here - splitting this into two
        // separately-filtered queries (tried first) made ONE of them hit a genuine Postgres
        // statement timeout on later chunks (older races, more accumulated predictions per race)
        // even though each query's own SELECT was narrow - the NOT NULL filter combined with
        // `IN (100 race_ids)` was the expensive part to plan/execute, not the payload size. A single
        // unfiltered fetch (still narrowed to exclude all_horses/predicted_times - see below) lets
        // Postgres use the existing (race_id, model_version, predicted_at) index cleanly; the
        // scored-vs-unscored split now happens in JS instead - found + fixed 2026-09-10.
        supabase
          .from('predictions')
          .select('id, race_id, model_version, predicted_at, confidence_scores, podium:predictions->podium, actual_results')
          .in('race_id', chunk)
          .order('predicted_at', { ascending: false }),
      ])))
      for (const [entriesResult, predictionsResult] of batchResults) {
        if (entriesResult.error) throw entriesResult.error
        if (predictionsResult.error) throw predictionsResult.error
        entriesData.push(...(entriesResult.data as typeof entriesData))
        for (const row of (predictionsResult.data as unknown as Array<PredictionMeta & { race_id: string; podium: PredictionPayload['podium'] | null; actual_results: ScoredPredictionRow['actual_results'] | null }>)) {
          if (row.actual_results) scoredData.push(row as typeof scoredData[number])
          else unscoredNeedsFullFetch.push(row)
        }
      }
    }
    // Only the genuinely-unscored rows (normally just a handful of newly-completed races) need a
    // follow-up fetch for the heavier fields (all_horses/predicted_times) that evaluatePrediction()
    // requires - the vast majority of rows never reach this path.
    if (unscoredNeedsFullFetch.length) {
      const unscoredIds = unscoredNeedsFullFetch.map((row) => row.id)
      for (let offset = 0; offset < unscoredIds.length; offset += 100) {
        const idBatch = unscoredIds.slice(offset, offset + 100)
        const { data, error } = await supabase
          .from('predictions')
          .select('id, race_id, model_version, predicted_at, confidence_scores, predicted_times, podium:predictions->podium, all_horses:predictions->all_horses')
          .in('id', idBatch)
        if (error) throw error
        unscoredData.push(...(data as unknown as typeof unscoredData))
      }
    }

    const entriesByRace = new Map<string, ActualRaceEntry[]>()
    for (const entry of entriesData) {
      const entries = entriesByRace.get(entry.race_id) ?? []
      entries.push(entry as ActualRaceEntry)
      entriesByRace.set(entry.race_id, entries)
    }

    // Keep the LATEST row per (race_id, model_version) - an unscored row can be newer than an
    // already-scored one (e.g. a retrospective re-run after a late scratching), so this must
    // compare actual timestamps, not just "prefer scored" or first-seen order.
    const latestByKey = new Map<string, { predictedAt: string; kind: 'unscored'; row: typeof unscoredData[number] } | { predictedAt: string; kind: 'scored'; row: typeof scoredData[number] }>()
    for (const row of unscoredData) {
      const key = `${row.race_id}:${row.model_version}`
      const existing = latestByKey.get(key)
      if (!existing || row.predicted_at > existing.predictedAt) latestByKey.set(key, { predictedAt: row.predicted_at, kind: 'unscored', row })
    }
    for (const row of scoredData) {
      const key = `${row.race_id}:${row.model_version}`
      const existing = latestByKey.get(key)
      if (!existing || row.predicted_at > existing.predictedAt) latestByKey.set(key, { predictedAt: row.predicted_at, kind: 'scored', row })
    }

    const raceDateById = new Map(races.map((race) => [race.id, race.race_datetime]))
    const outcomesByModel = new Map<string, ModelOutcome[]>()
    const scoredPredictions: Array<{
      id: string
      actual_results: Record<string, unknown>
      accuracy_score: number
    }> = []

    for (const entry of latestByKey.values()) {
      const raceDate = raceDateById.get(entry.row.race_id)
      if (!raceDate) continue

      let outcome: ModelOutcome | null
      if (entry.kind === 'unscored') {
        const prediction = entry.row
        const evaluated = evaluatePrediction(
          { podium: prediction.podium ?? [], all_horses: prediction.all_horses ?? [] },
          prediction.predicted_times,
          entriesByRace.get(prediction.race_id) ?? [],
        )
        if (!evaluated) continue
        scoredPredictions.push({
          id: prediction.id,
          actual_results: {
            podium: evaluated.actualPodium,
            winner_top3: evaluated.winnerTop3,
            podium_overlap: evaluated.podiumOverlap,
            ordered_trifecta: evaluated.orderedTrifecta,
            winner_brier_score: evaluated.winnerBrierScore,
            winner_log_loss: evaluated.winnerLogLoss,
          },
          accuracy_score: evaluated.accuracyScore,
        })
        outcome = {
          date: raceDate,
          correctWinner: evaluated.correctWinner,
          correctPodium: evaluated.correctPodium,
          confidence: prediction.confidence_scores.overall,
          timeErrors: evaluated.timeErrors,
          winnerTop3: evaluated.winnerTop3,
          podiumOverlap: evaluated.podiumOverlap,
          orderedTrifecta: evaluated.orderedTrifecta,
          winnerBrierScore: evaluated.winnerBrierScore,
          winnerLogLoss: evaluated.winnerLogLoss,
        }
      } else {
        outcome = outcomeFromStoredResult(entry.row, raceDate)
      }
      if (!outcome) continue

      const modelOutcomes = outcomesByModel.get(entry.row.model_version) ?? []
      modelOutcomes.push(outcome)
      outcomesByModel.set(entry.row.model_version, modelOutcomes)
    }

    const updateChunkSize = 20
    for (let offset = 0; offset < scoredPredictions.length; offset += updateChunkSize) {
      // A plain per-row UPDATE, not an upsert - Postgres validates NOT NULL constraints against
      // the full proposed row for an upsert's INSERT branch even when the ON CONFLICT DO UPDATE
      // path is the one actually taken, so upserting a body missing race_id/model_version/etc
      // (the whole point of the narrowed SELECT above) fails with "null value in column race_id
      // violates not-null constraint" - found live 2026-09-10. A plain .update() only ever
      // touches the columns given here, with no INSERT-branch tuple to validate.
      const batch = scoredPredictions.slice(offset, offset + updateChunkSize)
      const results = await Promise.all(batch.map((row) => supabase
        .from('predictions')
        .update({ actual_results: row.actual_results, accuracy_score: row.accuracy_score })
        .eq('id', row.id)))
      const updateError = results.find((result) => result.error)?.error
      if (updateError) throw updateError
    }

    for (const [modelVersion, outcomes] of outcomesByModel) {
      const dates = outcomes.map((outcome) => outcome.date.slice(0, 10)).sort()
      const correctWinners = outcomes.filter((outcome) => outcome.correctWinner).length
      const correctPodiums = outcomes.filter((outcome) => outcome.correctPodium).length
      const timeErrors = outcomes.flatMap((outcome) => outcome.timeErrors)
      const totalRaces = outcomes.length
      const { error: logError } = await supabase.from('accuracy_log').upsert({
        period_start: dates[0],
        period_end: dates.at(-1),
        total_races: totalRaces,
        correct_winners: correctWinners,
        correct_podiums: correctPodiums,
        winner_accuracy: correctWinners / totalRaces,
        podium_accuracy: correctPodiums / totalRaces,
        avg_confidence: outcomes.reduce((sum, outcome) => sum + outcome.confidence, 0) / totalRaces,
        avg_time_error: timeErrors.length
          ? timeErrors.reduce((sum, error) => sum + error, 0) / timeErrors.length
          : null,
        model_version: modelVersion,
        logged_at: new Date().toISOString(),
      }, { onConflict: 'period_start,period_end,model_version' })
      if (logError) throw logError
    }

    const scored = [...outcomesByModel.values()].reduce((sum, outcomes) => sum + outcomes.length, 0)
    if (!scored) {
      return NextResponse.json({ success: false, message: 'No completed races had predictions and results' }, { status: 404 })
    }

    const metrics = Object.fromEntries([...outcomesByModel].map(([modelVersion, outcomes]) => [modelVersion, {
      races: outcomes.length,
      winnerAccuracy: outcomes.filter((outcome) => outcome.correctWinner).length / outcomes.length,
      winnerTop3Accuracy: outcomes.filter((outcome) => outcome.winnerTop3).length / outcomes.length,
      averagePodiumOverlap: outcomes.reduce((sum, outcome) => sum + outcome.podiumOverlap, 0) / outcomes.length,
      anyOrderPodiumAccuracy: outcomes.filter((outcome) => outcome.correctPodium).length / outcomes.length,
      orderedTrifectaAccuracy: outcomes.filter((outcome) => outcome.orderedTrifecta).length / outcomes.length,
      winnerBrierScore: outcomes.reduce((sum, outcome) => sum + outcome.winnerBrierScore, 0) / outcomes.length,
      winnerLogLoss: outcomes.reduce((sum, outcome) => sum + outcome.winnerLogLoss, 0) / outcomes.length,
    }]))

    return NextResponse.json({
      success: true,
      scored,
      models: outcomesByModel.size,
      metrics,
      message: `Backtested ${scored} predictions across ${outcomesByModel.size} models`,
    })
  } catch (error) {
    console.error('Backtest failed', error)
    return NextResponse.json({ success: false, message: 'Backtest failed' }, { status: 500 })
  }
}
