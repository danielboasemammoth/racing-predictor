import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { evaluatePrediction, type ActualRaceEntry } from '@/lib/backtest'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Prediction } from '@/lib/types'

interface CompletedRace {
  id: string
  race_datetime: string
}

type PredictionRow = Pick<Prediction, 'id' | 'race_id' | 'model_version' | 'predicted_at' | 'predictions' | 'confidence_scores' | 'predicted_times'>

export async function POST() {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const { data: racesData, error: racesError } = await supabase
      .from('races')
      .select('id, race_datetime')
      .eq('status', 'completed')
      .order('race_datetime', { ascending: false })
      .limit(500)

    if (racesError) throw racesError
    const races = (racesData ?? []) as CompletedRace[]
    if (!races.length) {
      return NextResponse.json({ success: false, message: 'No completed races to backtest' }, { status: 404 })
    }

    const raceIds = races.map((race) => race.id)
    const entriesData: ActualRaceEntry[] & Array<{ race_id: string }> = []
    const predictionsData: PredictionRow[] = []
    const raceChunkSize = 40
    for (let offset = 0; offset < raceIds.length; offset += raceChunkSize) {
      const chunk = raceIds.slice(offset, offset + raceChunkSize)
      const [entriesResult, predictionsResult] = await Promise.all([
        supabase
          .from('race_entries')
          .select('race_id, horse_id, finishing_position, finishing_time')
          .in('race_id', chunk),
        supabase
          .from('predictions')
          .select('id, race_id, model_version, predicted_at, predictions, confidence_scores, predicted_times')
          .in('race_id', chunk),
      ])
      if (entriesResult.error) throw entriesResult.error
      if (predictionsResult.error) throw predictionsResult.error
      entriesData.push(...(entriesResult.data as typeof entriesData))
      predictionsData.push(...(predictionsResult.data as PredictionRow[]))
    }

    const entriesByRace = new Map<string, ActualRaceEntry[]>()
    for (const entry of entriesData) {
      const entries = entriesByRace.get(entry.race_id) ?? []
      entries.push(entry as ActualRaceEntry)
      entriesByRace.set(entry.race_id, entries)
    }

    const latestPredictions = new Map<string, PredictionRow>()
    for (const prediction of predictionsData) {
      const key = `${prediction.race_id}:${prediction.model_version}`
      if (!latestPredictions.has(key)) latestPredictions.set(key, prediction)
    }

    const raceDateById = new Map(races.map((race) => [race.id, race.race_datetime]))
    const outcomesByModel = new Map<string, Array<{
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
    }>>()

    for (const prediction of latestPredictions.values()) {
      const outcome = evaluatePrediction(
        prediction.predictions,
        prediction.predicted_times,
        entriesByRace.get(prediction.race_id) ?? [],
      )
      const raceDate = raceDateById.get(prediction.race_id)
      if (!outcome || !raceDate) continue

      const { error: updateError } = await supabase
        .from('predictions')
        .update({
          actual_results: {
            podium: outcome.actualPodium,
            winner_top3: outcome.winnerTop3,
            podium_overlap: outcome.podiumOverlap,
            ordered_trifecta: outcome.orderedTrifecta,
            winner_brier_score: outcome.winnerBrierScore,
            winner_log_loss: outcome.winnerLogLoss,
          },
          accuracy_score: outcome.accuracyScore,
        })
        .eq('id', prediction.id)
      if (updateError) throw updateError

      const modelOutcomes = outcomesByModel.get(prediction.model_version) ?? []
      modelOutcomes.push({
        date: raceDate,
        correctWinner: outcome.correctWinner,
        correctPodium: outcome.correctPodium,
        confidence: prediction.confidence_scores.overall,
        timeErrors: outcome.timeErrors,
        winnerTop3: outcome.winnerTop3,
        podiumOverlap: outcome.podiumOverlap,
        orderedTrifecta: outcome.orderedTrifecta,
        winnerBrierScore: outcome.winnerBrierScore,
        winnerLogLoss: outcome.winnerLogLoss,
      })
      outcomesByModel.set(prediction.model_version, modelOutcomes)
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
      winnerTop3Accuracy: outcomes.filter((outcome) => outcome.winnerTop3).length / outcomes.length,
      averagePodiumOverlap: outcomes.reduce((sum, outcome) => sum + outcome.podiumOverlap, 0) / outcomes.length,
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
