/**
 * Genuine ROLLING walk-forward validation (reliability spec section 4: "train Jan-Apr, validate
 * May; then train Jan-May, validate June; continue forward through history" - NOT a single
 * static split like scripts/reliability-analysis.ts's 70/30 discovery/holdout or
 * scripts/train-logit-weights.ts's 60/20/20). History available to the model for each calendar
 * month grows forward month by month; a month is never scored using data from a later month.
 *
 * Also implements the required baselines (spec section 5) that were missing from this repo:
 * - Market favourite: cheapest recorded price per race (Racing.com's own feed - NOT a confirmed
 *   TAB/Betfair price, see extractBestWinOdds's own doc comment).
 * - Simple recent-form-only ranking: the model's own `recentForm` feature alone, nothing else.
 * - Simple average-rating baseline: unweighted mean of all 13 features (no hand-tuned weights).
 * - Random ranking: computed analytically (mean of 1/fieldSize), not sampled, so it is exact and
 *   reproducible without needing a fixed RNG seed (spec section 48).
 * These are compared window-by-window and in aggregate against the current production ensemble
 * (v4.1-ensemble). Only covers the internal Racing.com HORSE pipeline - greyhound/harness run
 * through the separate PuntersEdge paper-betting system (see /memories/repo/puntersedge-api.md).
 *
 * Read-only research script: prints a report, writes a local JSON copy, and publishes a summary
 * snapshot to Supabase (analysis_snapshots, kind='walk-forward-backtest') for future admin/
 * research UI use - it never touches production model weights or predictions.
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'node:fs'
import { evaluatePrediction } from '../src/lib/backtest'
import { MODEL_CONFIGS, type Features, type HistoricalStart } from '../src/lib/prediction-v3'
import { PRODUCTION_ENSEMBLE_CONFIGS, runConfiguredModel, runEnsemble } from '../src/lib/prediction-suite'
import { extractBestWinOdds } from '../src/lib/roi-analysis'
import { normalizedMarketProbabilities } from '../src/lib/reliability-analysis'
import { parseStandardTimeDifference } from '../src/lib/sectional-speed'
import type { RaceEntryWithHorse } from '../src/lib/types'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })

const FEATURE_KEYS = [
  'recentForm', 'contextualForm', 'distanceSuitability', 'conditionSuitability', 'courseSuitability',
  'classMovement', 'speedRating', 'jockeyForm', 'trainerForm', 'partnershipForm',
  'barrierSuitability', 'weightSuitability', 'fitness',
] as const satisfies ReadonlyArray<keyof Omit<Features, 'historyStarts'>>

/** Calendar months of history required before the first validation window (matches the spec's own "Jan-Apr" example). */
const BURN_IN_MONTHS = 3

interface Race {
  id: string
  race_datetime: string
  distance_m: number | null
  track_condition: string | null
  race_class: string | null
  racecourse_id: string
}

const supabase = createScriptClient()

async function loadData() {
  const races: Race[] = []
  for (let offset = 0; ; offset += 1_000) {
    const { data, error } = await supabase.from('races')
      .select('id,race_datetime,distance_m,track_condition,race_class,racecourse_id')
      .eq('status', 'completed').order('race_datetime').range(offset, offset + 999)
    if (error) throw error
    races.push(...((data ?? []) as Race[]))
    if (!data || data.length < 1_000) break
  }
  const entries: (RaceEntryWithHorse & { speed_ratings: { standard_time_difference?: string | null } | null })[] = []
  for (let offset = 0; offset < races.length; offset += 40) {
    const { data, error } = await supabase.from('race_entries').select('*,horses(*)')
      .in('race_id', races.slice(offset, offset + 40).map((race) => race.id))
    if (error) throw error
    entries.push(...((data ?? []) as typeof entries))
  }
  return { races, entriesByRace: Map.groupBy(entries, (entry) => entry.race_id) }
}

function start(entry: RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race: Race, fieldSize: number): HistoricalStart {
  return {
    raceId: race.id, horseId: entry.horse_id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime,
    distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined,
    raceClass: race.race_class ?? undefined, finishingPosition: entry.finishing_position, fieldSize,
    finishingTime: entry.finishing_time, margin: entry.margin, barrier: entry.barrier_number,
    weight: entry.weight_carried, jockey: entry.jockey, trainer: entry.trainer,
    standardTimeDifference: parseStandardTimeDifference(entry.speed_ratings?.standard_time_difference) ?? undefined,
  }
}

function monthKey(raceDatetime: string) {
  return raceDatetime.slice(0, 7) // 'YYYY-MM' - approximate calendar bucketing, consistent with the rest of this project's scripts (no Melbourne-timezone adjustment needed for month-level grouping).
}

interface RunnerVector { horseId: string; x: number[]; won: boolean; odds: number | null }

/** Extracts each runner's feature vector + best recorded price for a race, via the existing (weight-independent) feature computation. */
function extractRunnerVectors(race: Race, field: RaceEntryWithHorse[], history: HistoricalStart[]): RunnerVector[] | null {
  const winnerId = field.find((entry) => entry.finishing_position === 1)?.horse_id
  if (!winnerId) return null
  const result = runConfiguredModel({
    race: { id: race.id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime, distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined, raceClass: race.race_class ?? undefined },
    entries: field,
    history,
    fieldSize: field.length,
  }, MODEL_CONFIGS.connections)
  const snapshots = result.predictions.feature_snapshots as Record<string, { features: Record<string, number> }> | undefined
  if (!snapshots) return null
  const runners = field.flatMap((entry) => {
    const features = snapshots[entry.horse_id]?.features
    if (!features) return []
    const x = FEATURE_KEYS.map((key) => (features[key] ?? 0.5) - 0.5)
    return [{ horseId: entry.horse_id, x, won: entry.horse_id === winnerId, odds: extractBestWinOdds(entry.sectional_times) }]
  })
  return runners.length >= 2 ? runners : null
}

function softmax(scores: number[]): number[] {
  const max = Math.max(...scores)
  const exp = scores.map((score) => Math.exp(score - max))
  const total = exp.reduce((sum, value) => sum + value, 0)
  return exp.map((value) => value / total)
}

interface Accumulator { n: number; winnerHits: number; brierSum: number; logLossSum: number; coveredN: number }
function empty(): Accumulator { return { n: 0, winnerHits: 0, brierSum: 0, logLossSum: 0, coveredN: 0 } }

function addOutcome(acc: Accumulator, correctWinner: boolean, winnerProbability: number | null) {
  acc.n += 1
  if (correctWinner) acc.winnerHits += 1
  if (winnerProbability !== null) {
    acc.coveredN += 1
    acc.brierSum += (winnerProbability - 1) ** 2 // only the winner's term matters for the aggregate mean-Brier reported here (see report()).
    acc.logLossSum += -Math.log(Math.max(winnerProbability, 1e-9))
  }
}

function report(label: string, acc: Accumulator) {
  const winnerAcc = acc.n ? (acc.winnerHits / acc.n) * 100 : 0
  const brier = acc.coveredN ? acc.brierSum / acc.coveredN : null
  const logLoss = acc.coveredN ? acc.logLossSum / acc.coveredN : null
  return `${label.padEnd(24)} n=${String(acc.n).padEnd(5)} winnerAcc=${winnerAcc.toFixed(1)}%`
    + `  winnerBrierTerm=${brier !== null ? brier.toFixed(4) : 'n/a'}  winnerLogLoss=${logLoss !== null ? logLoss.toFixed(4) : 'n/a'}`
    + (acc.coveredN < acc.n ? `  (odds coverage ${acc.coveredN}/${acc.n})` : '')
}

async function main() {
  console.log('Loading completed races + entries...')
  const { races, entriesByRace } = await loadData()
  const valid = races
    .filter((race) => {
      const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
      return field.length >= 4 && field.filter((entry) => entry.finishing_position === 1).length === 1
    })
    .sort((left, right) => left.race_datetime.localeCompare(right.race_datetime))

  const months = [...new Set(valid.map((race) => monthKey(race.race_datetime)))].sort()
  console.log(`${valid.length} valid races across ${months.length} calendar months (${months[0]} to ${months[months.length - 1]}).`)
  if (months.length <= BURN_IN_MONTHS) {
    console.error(`Not enough distinct months of history (need > ${BURN_IN_MONTHS}) for a rolling walk-forward validation yet.`)
    return
  }

  const rollingHistory: HistoricalStart[] = []
  const windows: Array<{ month: string; races: number; ensemble: Accumulator; marketFavourite: Accumulator; recentFormOnly: Accumulator; averageRating: Accumulator; randomWinnerAcc: number }> = []

  const aggregate = { ensemble: empty(), marketFavourite: empty(), recentFormOnly: empty(), averageRating: empty() }
  let randomWeightedSum = 0
  let randomTotalN = 0

  for (let monthIndex = BURN_IN_MONTHS; monthIndex < months.length; monthIndex += 1) {
    const month = months[monthIndex]
    const windowRaces = valid.filter((race) => monthKey(race.race_datetime) === month)
    if (!windowRaces.length) continue

    const ensembleAcc = empty()
    const marketAcc = empty()
    const recentFormAcc = empty()
    const avgRatingAcc = empty()
    let randomSum = 0

    for (const race of windowRaces) {
      const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
      const raceContext = { id: race.id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime, distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined, raceClass: race.race_class ?? undefined }

      // 1. Production ensemble - exactly what the live app would have produced with history available at this point in time.
      const ensembleResult = runEnsemble({ race: raceContext, entries: field, history: rollingHistory, fieldSize: field.length }, PRODUCTION_ENSEMBLE_CONFIGS)
      const outcome = evaluatePrediction(ensembleResult.predictions, ensembleResult.predicted_times, field.map((entry) => ({ horse_id: entry.horse_id, finishing_position: entry.finishing_position ?? null, finishing_time: entry.finishing_time ?? null })))
      if (outcome) {
        const winnerId = field.find((entry) => entry.finishing_position === 1)!.horse_id
        const winnerProbability = ensembleResult.predictions.all_horses.find((horse) => horse.horse_id === winnerId)?.win_probability ?? null
        addOutcome(ensembleAcc, outcome.correctWinner, winnerProbability)
      }

      // 2. Baselines, computed from the same per-runner feature vectors (weight-independent).
      const winnerId = field.find((entry) => entry.finishing_position === 1)?.horse_id
      const vectors = extractRunnerVectors(race, field, rollingHistory)
      if (winnerId && vectors) {
        randomSum += 1 / vectors.length

        const withOdds = vectors.filter((v): v is RunnerVector & { odds: number } => v.odds !== null && v.odds > 0)
        if (withOdds.length >= 2) {
          const marketProbabilities = normalizedMarketProbabilities(withOdds.map((v) => v.odds))
          const favouriteIndex = marketProbabilities.reduce((best, p, i) => (p > marketProbabilities[best] ? i : best), 0)
          const winnerProbability = marketProbabilities[withOdds.findIndex((v) => v.horseId === winnerId)] ?? null
          addOutcome(marketAcc, withOdds[favouriteIndex].horseId === winnerId, winnerId && withOdds.some((v) => v.horseId === winnerId) ? winnerProbability : null)
        }

        const recentFormScores = vectors.map((v) => v.x[FEATURE_KEYS.indexOf('recentForm')])
        const recentFormProbabilities = softmax(recentFormScores)
        const recentFormWinnerIndex = recentFormProbabilities.reduce((best, p, i) => (p > recentFormProbabilities[best] ? i : best), 0)
        addOutcome(recentFormAcc, vectors[recentFormWinnerIndex].horseId === winnerId, recentFormProbabilities[vectors.findIndex((v) => v.horseId === winnerId)] ?? null)

        const avgRatingScores = vectors.map((v) => v.x.reduce((sum, xi) => sum + xi, 0) / v.x.length)
        const avgRatingProbabilities = softmax(avgRatingScores)
        const avgRatingWinnerIndex = avgRatingProbabilities.reduce((best, p, i) => (p > avgRatingProbabilities[best] ? i : best), 0)
        addOutcome(avgRatingAcc, vectors[avgRatingWinnerIndex].horseId === winnerId, avgRatingProbabilities[vectors.findIndex((v) => v.horseId === winnerId)] ?? null)
      }
    }

    for (const [key, acc] of Object.entries({ ensemble: ensembleAcc, marketFavourite: marketAcc, recentFormOnly: recentFormAcc, averageRating: avgRatingAcc }) as Array<[keyof typeof aggregate, Accumulator]>) {
      aggregate[key].n += acc.n
      aggregate[key].winnerHits += acc.winnerHits
      aggregate[key].coveredN += acc.coveredN
      aggregate[key].brierSum += acc.brierSum
      aggregate[key].logLossSum += acc.logLossSum
    }
    randomWeightedSum += randomSum
    randomTotalN += windowRaces.length

    windows.push({
      month, races: windowRaces.length, ensemble: ensembleAcc, marketFavourite: marketAcc,
      recentFormOnly: recentFormAcc, averageRating: avgRatingAcc,
      randomWinnerAcc: windowRaces.length ? (randomSum / windowRaces.length) * 100 : 0,
    })

    // Grow the rolling history forward with this month's races before moving to the next window - never in reverse.
    rollingHistory.push(...windowRaces.flatMap((race) => {
      const field = (entriesByRace.get(race.id) ?? []).filter((entry) => entry.status !== 'scratched')
      return field.map((entry) => start(entry as RaceEntryWithHorse & { speed_ratings?: { standard_time_difference?: string | null } | null }, race, field.length))
    }))
  }

  console.log(`\nBurn-in: first ${BURN_IN_MONTHS} months (${months.slice(0, BURN_IN_MONTHS).join(', ')}) used only to seed rolling history, never scored.`)
  console.log(`Rolling walk-forward windows: ${windows.length} calendar months, history grows forward only.\n`)

  for (const window of windows) {
    console.log(`## ${window.month} (${window.races} races)`)
    console.log(`  ${report('Production ensemble', window.ensemble)}`)
    console.log(`  ${report('Market favourite', window.marketFavourite)}`)
    console.log(`  ${report('Recent-form only', window.recentFormOnly)}`)
    console.log(`  ${report('Average rating (equal wts)', window.averageRating)}`)
    console.log(`  Random ranking (expected): winnerAcc=${window.randomWinnerAcc.toFixed(1)}%`)
  }

  console.log('\n=========================================================')
  console.log(`AGGREGATE across all ${windows.length} rolling walk-forward windows:`)
  console.log(`  ${report('Production ensemble', aggregate.ensemble)}`)
  console.log(`  ${report('Market favourite', aggregate.marketFavourite)}`)
  console.log(`  ${report('Recent-form only', aggregate.recentFormOnly)}`)
  console.log(`  ${report('Average rating (equal wts)', aggregate.averageRating)}`)
  console.log(`  Random ranking (expected): winnerAcc=${randomTotalN ? ((randomWeightedSum / randomTotalN) * 100).toFixed(1) : '0.0'}%`)
  console.log('\nPer spec section 6 - the production model only "adds predictive value" if its aggregate winnerAcc/Brier/LogLoss beats the market-favourite row above, not just the random/average-rating floor.')

  const payload = {
    generatedAt: new Date().toISOString(),
    burnInMonths: BURN_IN_MONTHS,
    windows: windows.map((w) => ({
      month: w.month, races: w.races,
      ensemble: { n: w.ensemble.n, winnerAccPct: w.ensemble.n ? (w.ensemble.winnerHits / w.ensemble.n) * 100 : 0 },
      marketFavourite: { n: w.marketFavourite.n, winnerAccPct: w.marketFavourite.n ? (w.marketFavourite.winnerHits / w.marketFavourite.n) * 100 : 0 },
      recentFormOnly: { n: w.recentFormOnly.n, winnerAccPct: w.recentFormOnly.n ? (w.recentFormOnly.winnerHits / w.recentFormOnly.n) * 100 : 0 },
      averageRating: { n: w.averageRating.n, winnerAccPct: w.averageRating.n ? (w.averageRating.winnerHits / w.averageRating.n) * 100 : 0 },
      randomWinnerAccPct: w.randomWinnerAcc,
    })),
    aggregate: {
      ensemble: { n: aggregate.ensemble.n, winnerAccPct: aggregate.ensemble.n ? (aggregate.ensemble.winnerHits / aggregate.ensemble.n) * 100 : 0 },
      marketFavourite: { n: aggregate.marketFavourite.n, winnerAccPct: aggregate.marketFavourite.n ? (aggregate.marketFavourite.winnerHits / aggregate.marketFavourite.n) * 100 : 0 },
      recentFormOnly: { n: aggregate.recentFormOnly.n, winnerAccPct: aggregate.recentFormOnly.n ? (aggregate.recentFormOnly.winnerHits / aggregate.recentFormOnly.n) * 100 : 0 },
      averageRating: { n: aggregate.averageRating.n, winnerAccPct: aggregate.averageRating.n ? (aggregate.averageRating.winnerHits / aggregate.averageRating.n) * 100 : 0 },
      randomWinnerAccPct: randomTotalN ? (randomWeightedSum / randomTotalN) * 100 : 0,
    },
  }

  mkdirSync('scripts/output', { recursive: true })
  writeFileSync('scripts/output/walk-forward-backtest.json', JSON.stringify(payload, null, 2))
  console.log('\nWrote scripts/output/walk-forward-backtest.json.')

  const { error } = await supabase.from('analysis_snapshots')
    .upsert({ kind: 'walk-forward-backtest', payload, generated_at: payload.generatedAt }, { onConflict: 'kind' })
  if (error) throw error
  console.log('Published walk-forward-backtest snapshot to Supabase (analysis_snapshots table).')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Walk-forward backtest failed')
  process.exitCode = 1
})
