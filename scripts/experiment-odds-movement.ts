/**
 * Research (read-only): does late market MOVEMENT (steamers/drifters) identify winners the current
 * price does not? predictions rows are written hourly with the Racing.com best-price feed per
 * runner, so each race has a price history. For each completed race this compares the last
 * pre-jump price snapshot (A) with the snapshots 3h (B) and 8h (C) earlier:
 *   score_i = b1*log(pA_i) + b2*log(pA_i)^2 + m3*log(pA_i/pB_i) + m8*log(pA_i/pC_i)
 * Chronological 60/40 train/test; baseline is the same model without the movement terms. Uses the
 * results cache written by experiment-market-residual.ts (run that first).
 *
 *   npx tsx --env-file=.env.local scripts/experiment-odds-movement.ts
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })
const RESULTS = 'scripts/output/market-residual-data.json'
const SNAPSHOTS = 'scripts/output/odds-movement-snapshots.json'
const MODEL = 'v4.1-ensemble'
const HOUR = 3_600_000

interface Row { race_id: string; predicted_at: string; horses: Array<{ horse_id: string; win_odds?: number }> }
type Snapshots = Record<string, { a?: Row; b?: Row; c?: Row }>

async function loadSnapshots(races: Array<{ id: string; race_datetime: string }>): Promise<Snapshots> {
  if (existsSync(SNAPSHOTS) && !process.argv.includes('--refresh')) return JSON.parse(readFileSync(SNAPSHOTS, 'utf8'))
  const db = createScriptClient()
  const out: Snapshots = {}
  const latest = async (raceId: string, before: string): Promise<Row | undefined> => {
    const { data, error } = await db.from('predictions').select('race_id,predicted_at,horses:predictions->all_horses')
      .eq('race_id', raceId).eq('model_version', MODEL).lt('predicted_at', before).order('predicted_at', { ascending: false }).limit(1)
    if (error) throw error
    return data?.[0] as unknown as Row | undefined
  }
  let next = 0
  let done = 0
  const worker = async () => {
    for (;;) {
      const race = races[next++]
      if (!race) return
      const a = await latest(race.id, race.race_datetime)
      if (a) {
        const at = Date.parse(a.predicted_at)
        out[race.id] = { a, b: await latest(race.id, new Date(at - 3 * HOUR + 60_000).toISOString()), c: await latest(race.id, new Date(at - 8 * HOUR + 60_000).toISOString()) }
      }
      if (++done % 200 === 0) console.log(`  fetched ${done}/${races.length}`)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  writeFileSync(SNAPSHOTS, JSON.stringify(out))
  return out
}

function normalized(row: Row | undefined, ids: string[]): Map<string, number> | null {
  if (!row) return null
  const odds = new Map(row.horses.map(horse => [horse.horse_id, horse.win_odds]))
  const raw = ids.map(id => odds.get(id))
  if (raw.some(value => !(typeof value === 'number' && value > 1))) return null
  const implied = raw.map(value => 1 / value!)
  const total = implied.reduce((a, b) => a + b, 0)
  return new Map(ids.map((id, index) => [id, implied[index] / total]))
}

interface Runner { x: number[]; won: boolean; pa: number; sp: number }
interface Sample { time: number; runners: Runner[] }

function softmax(scores: number[]) {
  const max = Math.max(...scores)
  const exp = scores.map(score => Math.exp(score - max))
  const total = exp.reduce((a, b) => a + b, 0)
  return exp.map(value => value / total)
}

function fit(train: Sample[], active: number[], l2: number): number[] {
  const weights = active.map(index => (index === 0 ? 1 : 0))
  const m = new Array(weights.length).fill(0)
  const v = new Array(weights.length).fill(0)
  const prepared = train.map(sample => ({ rows: sample.runners.map(runner => active.map(index => runner.x[index])), won: sample.runners.findIndex(runner => runner.won) }))
  for (let step = 1; step <= 600; step++) {
    const gradient = new Array(weights.length).fill(0)
    for (const race of prepared) {
      const p = softmax(race.rows.map(row => row.reduce((a, value, j) => a + value * weights[j], 0)))
      race.rows.forEach((row, i) => { const diff = p[i] - (i === race.won ? 1 : 0); row.forEach((value, j) => { gradient[j] += diff * value }) })
    }
    for (let j = 0; j < weights.length; j++) {
      const g = gradient[j] / prepared.length + (active[j] <= 1 ? 0 : 2 * l2 * weights[j])
      m[j] = 0.9 * m[j] + 0.1 * g
      v[j] = 0.999 * v[j] + 0.001 * g * g
      weights[j] -= 0.03 * (m[j] / (1 - 0.9 ** step)) / (Math.sqrt(v[j] / (1 - 0.999 ** step)) + 1e-8)
    }
  }
  return weights
}

const predict = (sample: Sample, active: number[], weights: number[]) => softmax(sample.runners.map(runner => active.reduce((a, index, j) => a + runner.x[index] * weights[j], 0)))
const logLoss = (samples: Sample[], active: number[], weights: number[]) => samples.reduce((a, sample) => a - Math.log(Math.max(predict(sample, active, weights)[sample.runners.findIndex(runner => runner.won)], 1e-9)), 0) / samples.length

async function main() {
  if (!existsSync(RESULTS)) throw new Error('Run experiment-market-residual.ts first to create the results cache')
  const { races, entries } = JSON.parse(readFileSync(RESULTS, 'utf8')) as { races: Array<{ id: string; race_datetime: string }>; entries: Array<{ race_id: string; horse_id: string; status: string; finishing_position: number | null; starting_price: number | null }> }
  const recent = races.filter(race => race.race_datetime >= '2026-08-18')
  console.log(`Fetching price snapshots for ${recent.length} completed races since 2026-08-18`)
  const snapshots = await loadSnapshots(recent)
  const byRace = Map.groupBy(entries, entry => entry.race_id)
  const samples: Sample[] = []
  const lead = { a: [] as number[] }
  for (const race of recent) {
    const snap = snapshots[race.id]
    const field = (byRace.get(race.id) ?? []).filter(entry => entry.status !== 'scratched')
    if (!snap?.a || field.length < 4 || field.filter(entry => entry.finishing_position === 1).length !== 1) continue
    const ids = field.map(entry => entry.horse_id)
    const pa = normalized(snap.a, ids)
    const pb = normalized(snap.b, ids)
    const pc = normalized(snap.c, ids)
    if (!pa) continue
    lead.a.push((Date.parse(race.race_datetime) - Date.parse(snap.a.predicted_at)) / 60_000)
    samples.push({ time: Date.parse(race.race_datetime), runners: field.map(entry => {
      const a = pa.get(entry.horse_id)!
      const b = pb?.get(entry.horse_id)
      const c = pc?.get(entry.horse_id)
      return { won: entry.finishing_position === 1, pa: a, sp: entry.starting_price ?? 1 / a,
        x: [Math.log(a), Math.log(a) ** 2, b ? Math.log(a / b) : 0, c ? Math.log(a / c) : 0] }
    }) })
  }
  samples.sort((a, b) => a.time - b.time)
  lead.a.sort((a, b) => a - b)
  console.log(`Races with a usable final snapshot: ${samples.length}; median minutes before jump of that snapshot: ${lead.a[Math.floor(lead.a.length / 2)]?.toFixed(0)}`)
  const withMovement = samples.filter(sample => sample.runners.some(runner => runner.x[2] !== 0))
  console.log(`  with a comparable 3h-earlier price: ${withMovement.length}`)
  const cut = Math.floor(samples.length * 0.6)
  const [train, test] = [samples.slice(0, cut), samples.slice(cut)]
  console.log(`train ${train.length} / test ${test.length}`)

  const variants = [{ label: 'price only (log p)', active: [0], l2: 0 }, { label: 'price + longshot curve', active: [0, 1], l2: 0 },
    { label: 'price + curve + 3h move', active: [0, 1, 2], l2: 0.003 }, { label: 'price + curve + 3h + 8h move', active: [0, 1, 2, 3], l2: 0.003 }]
  for (const variant of variants) {
    const weights = fit(train, variant.active, variant.l2)
    const names = ['logP', 'logP^2', 'move3h', 'move8h']
    console.log(`  ${variant.label.padEnd(30)} train ${logLoss(train, variant.active, weights).toFixed(4)}  TEST ${logLoss(test, variant.active, weights).toFixed(4)}   weights ${variant.active.map((index, j) => `${names[index]}=${weights[j].toFixed(3)}`).join(' ')}`)
  }

  console.log('\nSteamers/drifters (3h move) among ALL runners in the test split, vs the final price:')
  const runners = test.flatMap(sample => sample.runners.map(runner => ({ ...runner, favourite: runner.pa === Math.max(...sample.runners.map(item => item.pa)) })))
  const bands: Array<[string, (move: number) => boolean]> = [['drifted >25%', move => move < -0.25], ['drifted 10-25%', move => move >= -0.25 && move < -0.1], ['steady', move => move >= -0.1 && move <= 0.1],
    ['firmed 10-25%', move => move > 0.1 && move <= 0.25], ['firmed >25%', move => move > 0.25]]
  for (const [label, test_] of bands) {
    const rows = runners.filter(runner => runner.x[2] !== 0 && test_(runner.x[2]))
    if (rows.length) console.log(`    ${label.padEnd(16)} runners ${String(rows.length).padStart(5)}  final-price ${(rows.reduce((a, r) => a + r.pa, 0) / rows.length * 100).toFixed(1)}%  actual ${(rows.filter(r => r.won).length / rows.length * 100).toFixed(1)}%  ROI@final-price ${((rows.filter(r => r.won).reduce((a, r) => a + 1 / r.pa, 0) / rows.length - 1) * 100).toFixed(1)}% (normalized prices, overround-free)`)
  }
  console.log('  non-favourites only:')
  for (const [label, test_] of bands) {
    const rows = runners.filter(runner => !runner.favourite && runner.x[2] !== 0 && test_(runner.x[2]))
    if (rows.length) console.log(`    ${label.padEnd(16)} runners ${String(rows.length).padStart(5)}  final-price ${(rows.reduce((a, r) => a + r.pa, 0) / rows.length * 100).toFixed(1)}%  actual ${(rows.filter(r => r.won).length / rows.length * 100).toFixed(1)}%`)
  }
}

main().catch(error => { console.error(error); process.exit(1) })
