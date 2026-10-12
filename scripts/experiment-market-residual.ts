/**
 * Research (read-only): can anything beat the market for picking NON-favourite winners?
 *
 * The production champion (v6-market-blend) is 90% market, so by construction it re-finds the
 * favourite and cannot surface winners the market under-rates. This experiment fits a conditional
 * logit with the market as an OFFSET-like term, score_i = b1*log(pm_i) + b2*log(pm_i)^2 + g.x_i,
 * where x_i are time-safe horse/jockey/trainer/race-shape features (the existing 13 plus new
 * ones: freshness, handicap-rating and weight vs field, early pace x field pace, recent
 * jockey/trainer hot form, jockey change, market-relative form, proven at distance/condition/
 * course). The b2 term directly tests favourite-longshot bias.
 *
 * Chronological 60/20/20 train/validation/test split. L2 is chosen on validation; the test split
 * is confirmatory only. Market = official starting price (closing), a harder baseline than the
 * earlier feed price the live model sees. Nothing is written.
 *
 *   npx tsx --env-file=.env.local scripts/experiment-market-residual.ts [--refresh]
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { runConfiguredModel } from '../src/lib/prediction-suite'
import { MODEL_CONFIGS, type HistoricalStart } from '../src/lib/prediction-v3'
import { extractBestWinOdds } from '../src/lib/roi-analysis'
import { parseStandardTimeDifference } from '../src/lib/sectional-speed'
import type { RaceEntryWithHorse } from '../src/lib/types'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })
const CACHE = process.env.EXPERIMENT_CACHE ?? 'scripts/output/market-residual-data.json'

interface Race { id: string; race_datetime: string; distance_m: number | null; track_condition: string | null; race_class: string | null; racecourse_id: string }
type Entry = RaceEntryWithHorse & { odds?: unknown }

const FEATURES = [
  'recentForm', 'contextualForm', 'distanceSuitability', 'conditionSuitability', 'courseSuitability', 'classMovement', 'speedRating',
  'jockeyForm', 'trainerForm', 'partnershipForm', 'barrierSuitability', 'weightSuitability', 'fitness',
] as const
const NEW_FEATURES = [
  'logDaysSince', 'debut', 'firstUp', 'careerStrike', 'lastStartWon', 'lastStartBeaten', 'ratingZ', 'ratingChange', 'weightZ', 'barrierPct',
  'leaderness', 'leaderXPace', 'jockey60', 'trainer60', 'jockeyChanged', 'beatMarketForm', 'wonAtDistance', 'wonAtCondition', 'wonAtCourse',
] as const
const NAMES = ['logPm', 'logPm2', ...FEATURES, ...NEW_FEATURES]

async function load(): Promise<{ races: Race[]; entries: Entry[] }> {
  if (!process.argv.includes('--refresh') && existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'))
  const db = createScriptClient()
  const races: Race[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from('races').select('id,race_datetime,distance_m,track_condition,race_class,racecourse_id')
      .eq('status', 'completed').order('race_datetime').range(offset, offset + 999)
    if (error) throw error
    races.push(...(data as Race[]))
    if (!data || data.length < 1000) break
  }
  const entries: Entry[] = []
  for (let offset = 0; offset < races.length; offset += 40) {
    const { data, error } = await db.from('race_entries')
      .select('id,race_id,horse_id,barrier_number,weight_carried,jockey,trainer,finishing_position,finishing_time,margin,status,speed_ratings,running_positions,handicap_rating,starting_price,odds:sectional_times->odds,horses(*)')
      .in('race_id', races.slice(offset, offset + 40).map(race => race.id))
    if (error) throw error
    entries.push(...(data as unknown as Entry[]))
  }
  mkdirSync(dirname(CACHE), { recursive: true })
  writeFileSync(CACHE, JSON.stringify({ races, entries }))
  return { races, entries }
}

function asStart(entry: Entry, race: Race, fieldSize: number): HistoricalStart {
  return {
    raceId: race.id, horseId: entry.horse_id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime,
    distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined, raceClass: race.race_class ?? undefined,
    finishingPosition: entry.finishing_position, fieldSize, finishingTime: entry.finishing_time, margin: entry.margin,
    barrier: entry.barrier_number, weight: entry.weight_carried, jockey: entry.jockey, trainer: entry.trainer,
    standardTimeDifference: parseStandardTimeDifference((entry.speed_ratings as { standard_time_difference?: string | null } | null)?.standard_time_difference) ?? undefined,
  }
}

const condGroup = (value: string | null) => { const v = value?.toLowerCase() ?? ''; return v.includes('heavy') ? 'h' : v.includes('soft') || v.includes('wet') ? 's' : v.includes('synthetic') ? 'y' : 'd' }
const clip = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value))
function zscores(values: Array<number | null>): number[] {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (known.length < Math.max(3, values.length * 0.6)) return values.map(() => 0)
  const mean = known.reduce((a, b) => a + b, 0) / known.length
  const sd = Math.sqrt(known.reduce((a, b) => a + (b - mean) ** 2, 0) / known.length) || 1
  return values.map(value => value === null || !Number.isFinite(value) ? 0 : (value - mean) / sd)
}

interface Past { time: number; won: boolean; pos: number; field: number; margin: number | null; rating: number | null; jockey: string | undefined; distance: number | null; cond: string; course: string; early: number | null; residual: number | null }
interface Runner { x: number[]; won: boolean; pm: number; sp: number }
interface Sample { time: number; runners: Runner[] }

function build(races: Race[], entries: Entry[]): Sample[] {
  const byRace = Map.groupBy(entries, entry => entry.race_id)
  const horseState = new Map<string, Past[]>()
  const people = new Map<string, Array<{ time: number; won: boolean }>>()
  const history: HistoricalStart[] = []
  const samples: Sample[] = []
  const dayMs = 86_400_000
  const rate = (rows: Array<{ time: number; won: boolean }> | undefined, now: number, days: number, prior: number) => {
    const recent = (rows ?? []).filter(row => row.time < now && now - row.time <= days * dayMs)
    return (recent.filter(row => row.won).length + 0.08 * prior) / (recent.length + prior) - 0.08
  }
  for (const race of races) {
    const now = Date.parse(race.race_datetime)
    const field = (byRace.get(race.id) ?? []).filter(entry => entry.status !== 'scratched')
    const winners = field.filter(entry => entry.finishing_position === 1)
    const prices = field.map(entry => (entry.starting_price ?? extractBestWinOdds({ odds: entry.odds })) ?? null)
    const usable = field.length >= 4 && winners.length === 1 && prices.every(price => price !== null && price > 1)
    if (usable) {
      const result = runConfiguredModel({
        race: { id: race.id, racecourseId: race.racecourse_id, raceDatetime: race.race_datetime, distanceM: race.distance_m ?? undefined, trackCondition: race.track_condition ?? undefined, raceClass: race.race_class ?? undefined },
        entries: field, history, fieldSize: field.length,
      }, MODEL_CONFIGS.connections)
      const snapshots = result.predictions.feature_snapshots as Record<string, { features: Record<string, number> }> | undefined
      if (snapshots) {
        const implied = prices.map(price => 1 / price!)
        const total = implied.reduce((a, b) => a + b, 0)
        const pms = implied.map(value => value / total)
        const ratingZ = zscores(field.map(entry => entry.handicap_rating ?? null))
        const weightZ = zscores(field.map(entry => entry.weight_carried ?? null))
        const pasts = field.map(entry => horseState.get(entry.horse_id) ?? [])
        const leaderness = pasts.map(rows => { const early = rows.slice(-5).flatMap(row => row.early === null ? [] : [row.early]); return early.length ? 1 - early.reduce((a, b) => a + b, 0) / early.length : 0.5 })
        const leaders = leaderness.filter(value => value > 0.8).length
        const runners: Runner[] = field.map((entry, index) => {
          const base = snapshots[entry.horse_id]?.features ?? {}
          const rows = pasts[index]
          const last = rows.at(-1)
          const days = last ? (now - last.time) / dayMs : null
          const recent = rows.slice(-5)
          const careerWins = rows.filter(row => row.won).length
          const distance = race.distance_m ?? null
          const x = [
            Math.log(pms[index]), Math.log(pms[index]) ** 2,
            ...FEATURES.map(key => (base[key] ?? 0.5) - 0.5),
            days === null ? 0 : Math.log(1 + Math.min(days, 400)) - 3.5,
            last ? 0 : 1,
            days !== null && days >= 70 ? 1 : 0,
            (careerWins + 0.4) / (rows.length + 5) - 0.08,
            last?.won ? 1 : 0,
            last && !last.won && last.margin !== null ? Math.min(last.margin, 10) / 10 : 0,
            ratingZ[index],
            last?.rating != null && entry.handicap_rating != null ? clip((entry.handicap_rating - last.rating) / 5, -2, 2) : 0,
            weightZ[index],
            field.length > 1 && entry.barrier_number ? (entry.barrier_number - 1) / (field.length - 1) - 0.5 : 0,
            leaderness[index] - 0.5,
            (leaderness[index] - 0.5) * clip((leaders - 2) / 2, -1, 2),
            rate(people.get(`j:${entry.jockey}`), now, 60, 20) * 10,
            rate(people.get(`t:${entry.trainer}`), now, 60, 20) * 10,
            last && entry.jockey && last.jockey && entry.jockey !== last.jockey ? 1 : 0,
            recent.length ? recent.reduce((a, row) => a + (row.residual ?? 0), 0) / recent.length * 5 : 0,
            rows.some(row => row.won && row.distance !== null && distance !== null && Math.abs(row.distance - distance) <= 200) ? 1 : 0,
            rows.some(row => row.won && row.cond === condGroup(race.track_condition)) ? 1 : 0,
            rows.some(row => row.won && row.course === race.racecourse_id) ? 1 : 0,
          ]
          return { x, won: entry.finishing_position === 1, pm: pms[index], sp: prices[index]! }
        })
        samples.push({ time: now, runners })
      }
    }
    // Update state only after the race, so no feature ever sees its own race or later.
    const implied = prices.map(price => price ? 1 / price : null)
    const total = implied.reduce<number>((a, b) => a + (b ?? 0), 0)
    for (const [index, entry] of field.entries()) {
      const rows = horseState.get(entry.horse_id) ?? []
      const pm = implied[index] !== null && total > 0 ? implied[index]! / total : null
      const early = (entry.running_positions as { at_settled?: number } | null)?.at_settled
      rows.push({
        time: now, won: entry.finishing_position === 1, pos: entry.finishing_position ?? 99, field: field.length, margin: entry.margin ?? null,
        rating: entry.handicap_rating ?? null, jockey: entry.jockey, distance: race.distance_m, cond: condGroup(race.track_condition), course: race.racecourse_id,
        early: typeof early === 'number' && field.length > 1 ? clip((early - 1) / (field.length - 1), 0, 1) : null,
        residual: pm === null ? null : (entry.finishing_position === 1 ? 1 : 0) - pm,
      })
      horseState.set(entry.horse_id, rows)
      for (const key of [`j:${entry.jockey}`, `t:${entry.trainer}`]) {
        const list = people.get(key) ?? []
        list.push({ time: now, won: entry.finishing_position === 1 })
        people.set(key, list)
      }
    }
    history.push(...field.map(entry => asStart(entry, race, field.length)))
  }
  return samples
}

function softmax(scores: number[]) {
  const max = Math.max(...scores)
  const exp = scores.map(score => Math.exp(score - max))
  const total = exp.reduce((a, b) => a + b, 0)
  return exp.map(value => value / total)
}

interface Scaler { mean: number[]; sd: number[] }
function scaler(samples: Sample[]): Scaler {
  const rows = samples.flatMap(sample => sample.runners.map(runner => runner.x))
  const width = rows[0].length
  const mean = Array.from({ length: width }, (_, j) => rows.reduce((a, row) => a + row[j], 0) / rows.length)
  const sd = Array.from({ length: width }, (_, j) => Math.sqrt(rows.reduce((a, row) => a + (row[j] - mean[j]) ** 2, 0) / rows.length) || 1)
  return { mean, sd }
}

/** Fits weights over the standardized columns `active`; logPm keeps its natural scale (init weight 1 = the raw market). */
function fit(train: Sample[], scale: Scaler, active: number[], l2: number, iterations = 500): number[] {
  const weights = active.map(index => (index === 0 ? 1 : 0))
  const z = (runner: Runner) => active.map(index => (runner.x[index] - scale.mean[index]) / scale.sd[index])
  const prepared = train.map(sample => ({ rows: sample.runners.map(z), won: sample.runners.findIndex(runner => runner.won) }))
  const m = new Array(weights.length).fill(0)
  const v = new Array(weights.length).fill(0)
  for (let step = 1; step <= iterations; step++) {
    const gradient = new Array(weights.length).fill(0)
    for (const race of prepared) {
      const probabilities = softmax(race.rows.map(row => row.reduce((a, value, j) => a + value * weights[j], 0)))
      race.rows.forEach((row, i) => { const diff = probabilities[i] - (i === race.won ? 1 : 0); row.forEach((value, j) => { gradient[j] += diff * value }) })
    }
    for (let j = 0; j < weights.length; j++) {
      // Market terms (columns 0/1) are not shrunk toward zero, only the residual features are.
      const penalty = active[j] <= 1 ? 0 : 2 * l2 * weights[j]
      const g = gradient[j] / prepared.length + penalty
      m[j] = 0.9 * m[j] + 0.1 * g
      v[j] = 0.999 * v[j] + 0.001 * g * g
      weights[j] -= 0.03 * (m[j] / (1 - 0.9 ** step)) / (Math.sqrt(v[j] / (1 - 0.999 ** step)) + 1e-8)
    }
  }
  return weights
}

function predict(sample: Sample, scale: Scaler, active: number[], weights: number[]) {
  return softmax(sample.runners.map(runner => active.reduce((a, index, j) => a + (runner.x[index] - scale.mean[index]) / scale.sd[index] * weights[j], 0)))
}

function evaluate(label: string, samples: Sample[], probabilitiesOf: (sample: Sample) => number[]) {
  let logLoss = 0
  let top = 0
  let favourite = 0
  let divergent = 0
  let divergentModelWins = 0
  let divergentFavouriteWins = 0
  let divergentStake = 0
  let divergentReturn = 0
  for (const sample of samples) {
    const p = probabilitiesOf(sample)
    const winner = sample.runners.findIndex(runner => runner.won)
    logLoss += -Math.log(Math.max(p[winner], 1e-9))
    const pick = p.indexOf(Math.max(...p))
    const fav = sample.runners.reduce((best, runner, index) => runner.pm > sample.runners[best].pm ? index : best, 0)
    if (pick === winner) top++
    if (fav === winner) favourite++
    if (pick !== fav) {
      divergent++
      if (pick === winner) { divergentModelWins++; divergentReturn += sample.runners[pick].sp }
      if (fav === winner) divergentFavouriteWins++
      divergentStake++
    }
  }
  const n = samples.length
  console.log(`  ${label.padEnd(30)} logLoss ${(logLoss / n).toFixed(4)}  top-1 ${(top / n * 100).toFixed(1)}%  (favourite ${(favourite / n * 100).toFixed(1)}%)`
    + `  | pick != favourite in ${(divergent / n * 100).toFixed(0)}% of races: pick wins ${divergent ? (divergentModelWins / divergent * 100).toFixed(1) : '-'}% vs favourite ${divergent ? (divergentFavouriteWins / divergent * 100).toFixed(1) : '-'}%, pick ROI@SP ${divergentStake ? ((divergentReturn / divergentStake - 1) * 100).toFixed(1) : '-'}%`)
}

function valueBands(samples: Sample[], probabilitiesOf: (sample: Sample) => number[]) {
  const bands = [{ name: 'ratio>=1.10', min: 1.1 }, { name: 'ratio>=1.25', min: 1.25 }, { name: 'ratio>=1.50', min: 1.5 }, { name: 'ratio>=2.00', min: 2 }]
  for (const band of bands) {
    for (const minOdds of [0, 4, 8]) {
      let bets = 0, wins = 0, ret = 0, expected = 0, marketExpected = 0
      for (const sample of samples) {
        const p = probabilitiesOf(sample)
        const fav = sample.runners.reduce((best, runner, index) => runner.pm > sample.runners[best].pm ? index : best, 0)
        sample.runners.forEach((runner, index) => {
          if (index === fav || runner.sp < minOdds || p[index] / runner.pm < band.min) return
          bets++; expected += p[index]; marketExpected += runner.pm
          if (runner.won) { wins++; ret += runner.sp }
        })
      }
      if (bets >= 20) console.log(`    non-favourites model/market ${band.name.padEnd(12)} SP>=${String(minOdds).padEnd(2)}  bets ${String(bets).padStart(5)}  win ${(wins / bets * 100).toFixed(1)}%  (model said ${(expected / bets * 100).toFixed(1)}%, market ${(marketExpected / bets * 100).toFixed(1)}%)  ROI@SP ${((ret / bets - 1) * 100).toFixed(1)}%`)
    }
  }
}

async function main() {
  const { races, entries } = await load()
  console.log(`Loaded ${races.length} completed races / ${entries.length} entries`)
  const samples = build(races, entries).sort((a, b) => a.time - b.time)
  const trainEnd = Math.floor(samples.length * 0.6)
  const valEnd = Math.floor(samples.length * 0.8)
  const [train, validation, test] = [samples.slice(0, trainEnd), samples.slice(trainEnd, valEnd), samples.slice(valEnd)]
  console.log(`Priced races with features: ${samples.length} (train ${train.length}, validation ${validation.length}, test ${test.length})`)
  const scale = scaler(train)
  const market = (sample: Sample) => softmax(sample.runners.map(runner => Math.log(runner.pm)))

  console.log('\nCalibration of the market itself on test (favourite-longshot bias): actual win rate vs normalized market probability')
  const bins = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 1.01]
  for (let i = 0; i < bins.length - 1; i++) {
    const rows = test.flatMap(sample => sample.runners).filter(runner => runner.pm >= bins[i] && runner.pm < bins[i + 1])
    if (rows.length) console.log(`    market ${(bins[i] * 100).toFixed(0).padStart(2)}-${(Math.min(bins[i + 1], 1) * 100).toFixed(0).padEnd(3)}%  runners ${String(rows.length).padStart(5)}  market ${(rows.reduce((a, r) => a + r.pm, 0) / rows.length * 100).toFixed(1)}%  actual ${(rows.filter(r => r.won).length / rows.length * 100).toFixed(1)}%  ROI@SP ${((rows.filter(r => r.won).reduce((a, r) => a + r.sp, 0) / rows.length - 1) * 100).toFixed(1)}%`)
  }
  const nonFavWinners = test.filter(sample => { const w = sample.runners.findIndex(r => r.won); return sample.runners.some(r => r.pm > sample.runners[w].pm) })
  console.log(`\nTest races won by a non-favourite: ${(nonFavWinners.length / test.length * 100).toFixed(1)}% (${nonFavWinners.length}/${test.length})`)

  const variants: Array<{ label: string; active: number[] }> = [
    { label: 'market + longshot curve', active: [0, 1] },
    { label: 'market + existing 13', active: [0, 1, ...FEATURES.map((_, i) => 2 + i)] },
    { label: 'market + new features', active: [0, 1, ...NEW_FEATURES.map((_, i) => 2 + FEATURES.length + i)] },
    { label: 'market + all features', active: NAMES.map((_, i) => i) },
  ]
  const results: Array<{ label: string; active: number[]; l2: number; weights: number[] }> = []
  for (const variant of variants) {
    let best: { l2: number; weights: number[]; loss: number } | null = null
    for (const l2 of variant.active.length <= 2 ? [0] : [0.0005, 0.003, 0.01, 0.03]) {
      const weights = fit(train, scale, variant.active, l2)
      const loss = validation.reduce((a, sample) => { const p = predict(sample, scale, variant.active, weights); return a - Math.log(Math.max(p[sample.runners.findIndex(r => r.won)], 1e-9)) }, 0) / validation.length
      if (!best || loss < best.loss) best = { l2, weights, loss }
    }
    results.push({ ...variant, l2: best!.l2, weights: best!.weights })
  }

  console.log('\nTEST split (confirmatory; validation chose L2 only)')
  evaluate('pure market (SP)', test, market)
  for (const result of results) evaluate(result.label, test, sample => predict(sample, scale, result.active, result.weights))

  const full = results.at(-1)!
  console.log(`\nFull model coefficients (standardized; l2=${full.l2}) - larger |w| = more incremental signal beyond the price:`)
  full.active.map((index, j) => ({ name: NAMES[index], w: full.weights[j] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .forEach(item => console.log(`    ${item.name.padEnd(20)} ${item.w >= 0 ? '+' : ''}${item.w.toFixed(3)}`))

  console.log('\nTEST value bands for the full model (non-favourites only, flat 1 unit at SP; compare ROI with the all-runner market ROI above):')
  valueBands(test, sample => predict(sample, scale, full.active, full.weights))
  console.log('\nSame bands on VALIDATION (sanity check that the test result is not a one-split fluke):')
  valueBands(validation, sample => predict(sample, scale, full.active, full.weights))
}

main().catch(error => { console.error(error); process.exit(1) })
