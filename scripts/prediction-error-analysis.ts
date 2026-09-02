/**
 * PREDICTION ERROR ANALYSIS (audit spec Parts 5-6, 39-40): for the production ensemble
 * (v4.1-ensemble), on every completed race, where did the ACTUAL WINNER rank in the model's own
 * probability ordering? Answers the spec's central question before any re-ranking work is
 * attempted: "is the winner usually already #2/#3 (a ranking problem) or usually outside the
 * top 5 (a data/candidate-generation problem)?" Read-only console report - no writes.
 */
import 'dotenv/config'
import { createScriptClient } from './supabase-client'
import { extractBestWinOdds } from '../src/lib/roi-analysis'
import type { PredictionPayload } from '../src/lib/types'

const MODEL_VERSION = 'v4.1-ensemble'

interface PredictionRow {
  race_id: string
  predictions: PredictionPayload
}

async function main() {
  const supabase = createScriptClient()

  const predictions: PredictionRow[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('predictions')
      .select('race_id, predictions, actual_results')
      .eq('model_version', MODEL_VERSION)
      .not('actual_results', 'is', null)
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    predictions.push(...((data ?? []) as PredictionRow[]))
    if (!data || data.length < pageSize) break
  }
  console.log(`Loaded ${predictions.length} scored ${MODEL_VERSION} predictions`)

  const raceIds = [...new Set(predictions.map((p) => p.race_id))]
  const entriesByRace = new Map<string, { horse_id: string; finishing_position: number | null; sectional_times: unknown }[]>()
  const chunkSize = 80 // UUID race_ids are long - a larger chunk overflows Supabase's request header limit
  for (let i = 0; i < raceIds.length; i += chunkSize) {
    const chunk = raceIds.slice(i, i + chunkSize)
    const { data, error } = await supabase.from('race_entries').select('race_id, horse_id, finishing_position, sectional_times').in('race_id', chunk)
    if (error) throw error
    for (const row of data ?? []) {
      const list = entriesByRace.get(row.race_id) ?? []
      list.push(row)
      entriesByRace.set(row.race_id, list)
    }
  }

  const buckets = { rank1: 0, rank2: 0, rank3: 0, rank4to5: 0, outsideTop5: 0, winnerNotInField: 0, noPodium: 0 }
  let totalRaces = 0

  for (const row of predictions) {
    const entries = entriesByRace.get(row.race_id) ?? []
    const winner = entries.find((e) => e.finishing_position === 1)
    if (!winner) continue
    totalRaces += 1

    const field = row.predictions.all_horses?.length ? row.predictions.all_horses : row.predictions.podium
    if (!field.length) {
      buckets.noPodium += 1
      continue
    }
    const ranked = [...field].sort((a, b) => (b.win_probability ?? b.confidence) - (a.win_probability ?? a.confidence))
    const winnerRank = ranked.findIndex((h) => h.horse_id === winner.horse_id) + 1 // 1-indexed, 0 means not found

    if (winnerRank === 0) buckets.winnerNotInField += 1
    else if (winnerRank === 1) buckets.rank1 += 1
    else if (winnerRank === 2) buckets.rank2 += 1
    else if (winnerRank === 3) buckets.rank3 += 1
    else if (winnerRank <= 5) buckets.rank4to5 += 1
    else buckets.outsideTop5 += 1
  }

  console.log(`\nWinner rank in model's own probability ordering (n=${totalRaces} races with a recorded winner):`)
  for (const [label, count] of Object.entries(buckets)) {
    const pct = totalRaces > 0 ? ((count / totalRaces) * 100).toFixed(1) : '0.0'
    console.log(`  ${label.padEnd(16)} ${String(count).padStart(6)}  (${pct}%)`)
  }

  const losses = totalRaces - buckets.rank1
  const rank2or3AmongLosses = buckets.rank2 + buckets.rank3
  console.log(`\nOf ${losses} losing #1 predictions (winner was NOT ranked #1):`)
  console.log(`  Winner was #2 or #3:      ${rank2or3AmongLosses} (${losses > 0 ? ((rank2or3AmongLosses / losses) * 100).toFixed(1) : '0.0'}%)`)
  console.log(`  Winner was #4-#5:         ${buckets.rank4to5} (${losses > 0 ? ((buckets.rank4to5 / losses) * 100).toFixed(1) : '0.0'}%)`)
  console.log(`  Winner outside top 5:     ${buckets.outsideTop5} (${losses > 0 ? ((buckets.outsideTop5 / losses) * 100).toFixed(1) : '0.0'}%)`)
  console.log(`  Winner not in field data: ${buckets.winnerNotInField} (${losses > 0 ? ((buckets.winnerNotInField / losses) * 100).toFixed(1) : '0.0'}%)`)

  // Spec Parts 16/37/47: does the model actually beat a trivial market-favourite baseline on the
  // exact same race set? (Racing.com's own recorded price feed - not confirmed TAB/Betfair.)
  let marketFavouriteWins = 0
  let bothHavePrice = 0
  let modelWinsWhereMarketHasPrice = 0
  let agreeWithMarketFavourite = 0
  for (const row of predictions) {
    const entries = entriesByRace.get(row.race_id) ?? []
    const winner = entries.find((e) => e.finishing_position === 1)
    if (!winner) continue
    const priced = entries
      .map((e) => ({ horse_id: e.horse_id, odds: extractBestWinOdds(e.sectional_times) }))
      .filter((e): e is { horse_id: string; odds: number } => e.odds != null)
    if (!priced.length) continue
    bothHavePrice += 1
    const favourite = priced.reduce((a, b) => (b.odds < a.odds ? b : a))
    if (favourite.horse_id === winner.horse_id) marketFavouriteWins += 1

    const modelPick = row.predictions.podium[0]?.horse_id
    if (modelPick === winner.horse_id) modelWinsWhereMarketHasPrice += 1
    if (modelPick === favourite.horse_id) agreeWithMarketFavourite += 1
  }
  console.log(`\nModel vs market-favourite baseline (n=${bothHavePrice} races with a recorded price):`)
  console.log(`  Model #1 winner accuracy:      ${((modelWinsWhereMarketHasPrice / bothHavePrice) * 100).toFixed(1)}%`)
  console.log(`  Market favourite accuracy:     ${((marketFavouriteWins / bothHavePrice) * 100).toFixed(1)}%`)
  console.log(`  Model agrees with favourite:   ${((agreeWithMarketFavourite / bothHavePrice) * 100).toFixed(1)}% of races`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
