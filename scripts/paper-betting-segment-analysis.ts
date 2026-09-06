/**
 * Follow-up to optimize-paper-betting-settings.ts: the full grid search found no profitable
 * threshold/staking config overall. This breaks the same real yesterday+today dataset down by
 * bet type (WIN/PLACE) and category (horse/greyhound/harness) for a few candidate threshold sets,
 * to check whether the aggregate loss is masking a profitable segment.
 *
 * Run with: npx tsx --env-file=.env.local scripts/paper-betting-segment-analysis.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { PuntersEdgeClient } from '../src/lib/puntersedge/client'
import type { PeRaceResult, RacingCategory } from '../src/lib/puntersedge/types'
import { DEFAULT_THRESHOLDS, type RecommendationThresholds } from '../src/lib/betting/recommendation-engine'
import type { ConfidenceLevel } from '../src/lib/betting/confidence'
import { probabilityEdgePoints, expectedValue } from '../src/lib/betting/odds-math'
import { settleBet } from '../src/lib/betting/paper-wallet'
import { melbourneDateKey } from '../src/lib/daily-picks'
import { createScriptClient } from './supabase-client'

const supabase = createScriptClient()
const LEVEL_RANK: Record<ConfidenceLevel, number> = { VERY_LOW: 0, LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4 }

interface Check {
  generatedAt: string
  edgePoints: number
  ev: number
  confidenceRank: number
  tabAgeSeconds: number
  featureCompleteness: number
  minutesToJump: number
  decimalOdds: number
  modelProbability: number
}

interface RunnerGroup {
  raceId: string
  runnerNumber: number
  category: RacingCategory
  winChecks: Check[]
  placeChecks: Check[]
  winOutcome: 'WON' | 'LOST' | 'SCRATCHED' | null
  placeOutcome: 'WON' | 'LOST' | 'SCRATCHED' | null
}

interface CandidateBet {
  betType: 'WIN' | 'PLACE'
  category: RacingCategory
  placedAt: string
  decimalOdds: number
  outcome: 'WON' | 'LOST' | 'SCRATCHED'
}

async function fetchAllResults(client: PuntersEdgeClient): Promise<Map<string, PeRaceResult>> {
  const byId = new Map<string, PeRaceResult>()
  const LIMIT = 200
  for (let offset = 0; ; offset += LIMIT) {
    const page = await client.results({ hoursBack: 48, status: 'final', country: ['AU'], limit: LIMIT, offset })
    for (const result of page) byId.set(result.race_id, result)
    if (page.length < LIMIT) break
  }
  return byId
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function fetchAllRows<T>(query: (rangeStart: number, rangeEnd: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await query(offset, offset + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

async function loadRunnerGroups(raceIds: string[], resultsByRaceId: Map<string, PeRaceResult>): Promise<RunnerGroup[]> {
  const runnerNumberById = new Map<string, { raceId: string; runnerNumber: number }>()
  const rawRecommendations: Array<{
    race_id: string
    runner_id: string
    generated_at: string
    category: RacingCategory
    model_probability: number | null
    tab_win_price: number | null
    tab_place_price: number | null
    tab_age_seconds: number | null
    confidence_level: ConfidenceLevel | null
    minutes_to_jump: number | null
    feature_completeness: number | null
    place_model_probability: number | null
  }> = []

  for (const raceIdChunk of chunk(raceIds, 25)) {
    const runners = await fetchAllRows<{ id: string; race_id: string; runner_number: number }>((start, end) =>
      supabase.from('pe_runners').select('id, race_id, runner_number').in('race_id', raceIdChunk).range(start, end),
    )
    for (const runner of runners) runnerNumberById.set(runner.id, { raceId: runner.race_id, runnerNumber: runner.runner_number })

    const recs = await fetchAllRows<(typeof rawRecommendations)[number]>((start, end) =>
      supabase
        .from('pe_recommendations')
        .select(
          'race_id, runner_id, generated_at, category, model_probability, tab_win_price, tab_place_price, tab_age_seconds, confidence_level, minutes_to_jump, feature_completeness, place_model_probability',
        )
        .in('race_id', raceIdChunk)
        .range(start, end),
    )
    rawRecommendations.push(...recs)
  }

  const groupByKey = new Map<string, RunnerGroup>()
  for (const rec of rawRecommendations) {
    const runner = runnerNumberById.get(rec.runner_id)
    if (!runner) continue
    const key = `${runner.raceId}::${runner.runnerNumber}`
    let group = groupByKey.get(key)
    if (!group) {
      group = { raceId: runner.raceId, runnerNumber: runner.runnerNumber, category: rec.category, winChecks: [], placeChecks: [], winOutcome: null, placeOutcome: null }
      groupByKey.set(key, group)
    }
    const confidenceRank = LEVEL_RANK[rec.confidence_level ?? 'VERY_LOW']
    const tabAgeSeconds = rec.tab_age_seconds ?? Number.POSITIVE_INFINITY
    const featureCompleteness = rec.feature_completeness ?? 0
    const minutesToJump = rec.minutes_to_jump ?? 0

    if (rec.model_probability != null && rec.tab_win_price != null && rec.tab_win_price > 1) {
      group.winChecks.push({
        generatedAt: rec.generated_at,
        edgePoints: probabilityEdgePoints(rec.model_probability, rec.tab_win_price),
        ev: expectedValue(rec.model_probability, rec.tab_win_price),
        confidenceRank,
        tabAgeSeconds,
        featureCompleteness,
        minutesToJump,
        decimalOdds: rec.tab_win_price,
        modelProbability: rec.model_probability,
      })
    }
    if (rec.place_model_probability != null && rec.tab_place_price != null && rec.tab_place_price > 1) {
      group.placeChecks.push({
        generatedAt: rec.generated_at,
        edgePoints: probabilityEdgePoints(rec.place_model_probability, rec.tab_place_price),
        ev: expectedValue(rec.place_model_probability, rec.tab_place_price),
        confidenceRank,
        tabAgeSeconds,
        featureCompleteness,
        minutesToJump,
        decimalOdds: rec.tab_place_price,
        modelProbability: rec.place_model_probability,
      })
    }
  }

  for (const group of groupByKey.values()) {
    group.winChecks.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
    group.placeChecks.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
    const result = resultsByRaceId.get(group.raceId)
    if (!result) continue
    const deducted = new Set((result.deductions ?? []).map((d) => d.number))
    const placingByNumber = new Map(result.placings.map((p) => [p.number, p]))
    const placeDividendNumbers = new Set((result.dividends?.straight ?? []).filter((d) => d.market === 'PLC').map((d) => d.number))

    group.winOutcome = deducted.has(group.runnerNumber) ? 'SCRATCHED' : placingByNumber.get(group.runnerNumber)?.position === 1 ? 'WON' : 'LOST'
    group.placeOutcome = deducted.has(group.runnerNumber) ? 'SCRATCHED' : placeDividendNumbers.has(group.runnerNumber) ? 'WON' : 'LOST'
  }

  return [...groupByKey.values()]
}

function qualifyingBets(groups: RunnerGroup[], thresholds: RecommendationThresholds): CandidateBet[] {
  const bets: CandidateBet[] = []
  const minRank = LEVEL_RANK[thresholds.minConfidenceLevel]

  for (const group of groups) {
    if (group.winOutcome) {
      for (const c of group.winChecks) {
        if (c.minutesToJump <= 0) continue
        if (c.edgePoints < thresholds.minEdgePoints) continue
        if (c.ev <= 0) continue
        if (c.confidenceRank < minRank) continue
        if (c.tabAgeSeconds > thresholds.maxPriceAgeSeconds) continue
        if (c.featureCompleteness < thresholds.minFeatureCompleteness) continue
        if (c.minutesToJump < thresholds.minMinutesToJump) continue
        if (c.minutesToJump > thresholds.maxMinutesToJump) continue
        bets.push({ betType: 'WIN', category: group.category, placedAt: c.generatedAt, decimalOdds: c.decimalOdds, outcome: group.winOutcome })
        break
      }
    }
    if (group.placeOutcome) {
      for (const c of group.placeChecks) {
        if (c.minutesToJump <= 0) continue
        if (c.edgePoints < thresholds.minEdgePoints) continue
        if (c.ev <= 0) continue
        if (c.confidenceRank < minRank) continue
        if (c.tabAgeSeconds > thresholds.maxPriceAgeSeconds) continue
        if (c.featureCompleteness < thresholds.minFeatureCompleteness) continue
        if (c.minutesToJump < thresholds.minMinutesToJump) continue
        if (c.minutesToJump > thresholds.maxMinutesToJump) continue
        bets.push({ betType: 'PLACE', category: group.category, placedAt: c.generatedAt, decimalOdds: c.decimalOdds, outcome: group.placeOutcome })
        break
      }
    }
  }
  return bets
}

/** Flat $1-per-bet ROI report (staking-invariant) - the cleanest signal for "does this segment have real edge". */
function reportSegment(label: string, bets: CandidateBet[]) {
  if (bets.length === 0) {
    console.log(`  ${label}: no qualifying bets`)
    return
  }
  let staked = 0
  let returned = 0
  let wins = 0
  for (const bet of bets) {
    const { returnAmount } = settleBet({ stake: 1, decimalOdds: bet.decimalOdds }, bet.outcome)
    staked += 1
    returned += returnAmount
    if (bet.outcome === 'WON') wins += 1
  }
  const netProfit = returned - staked
  const roiPct = (netProfit / staked) * 100
  console.log(`  ${label}: n=${bets.length}, win rate ${((wins / bets.length) * 100).toFixed(1)}%, flat-$1 ROI ${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%, net $${netProfit >= 0 ? '+' : ''}${netProfit.toFixed(2)} per $1/bet`)
}

async function main() {
  const client = new PuntersEdgeClient()
  const resultsByRaceId = await fetchAllResults(client)
  console.log(`Loaded ${resultsByRaceId.size} final race results`)
  const groups = await loadRunnerGroups([...resultsByRaceId.keys()], resultsByRaceId)
  const withOutcome = groups.filter((g) => g.winOutcome || g.placeOutcome)
  console.log(`Loaded ${withOutcome.length} runner groups with a matching final result\n`)

  const winningThresholds: RecommendationThresholds = {
    minEdgePoints: 10,
    minConfidenceLevel: 'VERY_LOW',
    maxPriceAgeSeconds: 60,
    minFeatureCompleteness: 0,
    minMinutesToJump: 1,
    maxMinutesToJump: 120,
  }

  const candidates: Array<{ label: string; thresholds: RecommendationThresholds }> = [
    { label: 'DEFAULT_THRESHOLDS (production today)', thresholds: DEFAULT_THRESHOLDS },
    { label: 'Grid-search winner (edge>=10, VERY_LOW conf, age<=60s, jump[1,120])', thresholds: winningThresholds },
    { label: 'Low edge floor (edge>=1, otherwise same as winner)', thresholds: { ...winningThresholds, minEdgePoints: 1 } },
    { label: 'Mid edge floor (edge>=5, otherwise same as winner)', thresholds: { ...winningThresholds, minEdgePoints: 5 } },
    { label: 'Very high edge floor (edge>=15)', thresholds: { ...winningThresholds, minEdgePoints: 15 } },
  ]

  for (const { label, thresholds } of candidates) {
    console.log(`\n=== ${label} ===`)
    const bets = qualifyingBets(withOutcome, thresholds)
    reportSegment('ALL', bets)
    reportSegment('WIN only', bets.filter((b) => b.betType === 'WIN'))
    reportSegment('PLACE only', bets.filter((b) => b.betType === 'PLACE'))
    for (const category of ['horse', 'greyhound', 'harness'] as RacingCategory[]) {
      reportSegment(`category=${category}`, bets.filter((b) => b.category === category))
    }
    const byDay = new Map<string, CandidateBet[]>()
    for (const bet of bets) {
      const day = melbourneDateKey(bet.placedAt)
      byDay.set(day, [...(byDay.get(day) ?? []), bet])
    }
    for (const [day, dayBets] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      reportSegment(`day=${day}`, dayBets)
    }
  }
}

main().catch((error) => {
  console.error('Segment analysis failed:', error)
  process.exit(1)
})
