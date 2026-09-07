/**
 * Backtests the PuntersEdge paper-betting engine's decision thresholds + staking settings against
 * every runner recommendation snapshot recorded for yesterday's and today's races, replaying each
 * candidate config's decisions against the REAL final PuntersEdge result for that race (never an
 * invented outcome). Grid-searches thresholds (recommendation-engine.ts) x staking method/caps
 * (kelly.ts) for the config that maximizes net profit from a $50 starting bankroll, and prints the
 * top results plus a per-day profit breakdown.
 *
 * Read-only against PuntersEdge/Supabase - does not place or settle any real paper bets. Run with:
 *   npx tsx --env-file=.env.local scripts/optimize-paper-betting-settings.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { PuntersEdgeClient } from '../src/lib/puntersedge/client'
import type { PeRaceResult, RacingCategory } from '../src/lib/puntersedge/types'
import type { RecommendationThresholds } from '../src/lib/betting/recommendation-engine'
import type { ConfidenceLevel } from '../src/lib/betting/confidence'
import { probabilityEdgePoints, expectedValue } from '../src/lib/betting/odds-math'
import { recommendedStake, type StakingMethod, type StakingCaps } from '../src/lib/betting/kelly'
import { settleBet, computeWalletStats, type WalletBetForStats } from '../src/lib/betting/paper-wallet'
import { melbourneDateKey } from '../src/lib/daily-picks'
import { createScriptClient } from './supabase-client'

const STARTING_BANKROLL = 50
const supabase = createScriptClient()

const LEVEL_RANK: Record<ConfidenceLevel, number> = { VERY_LOW: 0, LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4 }

/** Precomputed, threshold-independent numbers for one snapshot - lets the grid search do pure numeric comparisons instead of re-deriving edge/EV/reason strings on every combo. */
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
  winChecks: Check[]
  placeChecks: Check[]
  winOutcome: 'WON' | 'LOST' | 'SCRATCHED' | null
  placeOutcome: 'WON' | 'LOST' | 'SCRATCHED' | null
}

interface CandidateBet {
  betType: 'WIN' | 'PLACE'
  placedAt: string
  decimalOdds: number
  modelProbability: number
  edgePoints: number
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
      group = { raceId: runner.raceId, runnerNumber: runner.runnerNumber, winChecks: [], placeChecks: [], winOutcome: null, placeOutcome: null }
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

/**
 * First snapshot that would qualify as BET under `thresholds` - matches the real system's
 * idempotency (bets once, on the first qualifying sync). Pure numeric comparisons only (no
 * string building) since this runs inside a large grid search - mirrors recommend()'s BET
 * criteria in src/lib/betting/recommendation-engine.ts exactly, just without the reasons/
 * failedCriteria string construction that function does unconditionally.
 */
function qualifyingBets(groups: RunnerGroup[], thresholds: RecommendationThresholds): CandidateBet[] {
  const bets: CandidateBet[] = []
  const minRank = LEVEL_RANK[thresholds.minConfidenceLevel]

  for (const group of groups) {
    if (group.winOutcome) {
      for (const c of group.winChecks) {
        if (c.minutesToJump <= 0) continue // race already started - hard fail, regardless of thresholds
        if (c.edgePoints < thresholds.minEdgePoints) continue
        if (c.ev <= 0) continue
        if (c.confidenceRank < minRank) continue
        if (c.tabAgeSeconds > thresholds.maxPriceAgeSeconds) continue
        if (c.featureCompleteness < thresholds.minFeatureCompleteness) continue
        if (c.minutesToJump < thresholds.minMinutesToJump) continue
        if (c.minutesToJump > thresholds.maxMinutesToJump) continue
        bets.push({ betType: 'WIN', placedAt: c.generatedAt, decimalOdds: c.decimalOdds, modelProbability: c.modelProbability, edgePoints: c.edgePoints, outcome: group.winOutcome })
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
        bets.push({ betType: 'PLACE', placedAt: c.generatedAt, decimalOdds: c.decimalOdds, modelProbability: c.modelProbability, edgePoints: c.edgePoints, outcome: group.placeOutcome })
        break
      }
    }
  }

  bets.sort((a, b) => a.placedAt.localeCompare(b.placedAt))
  return bets
}

interface SimResult {
  netProfit: number
  roiPct: number
  numberOfBets: number
  numberSettled: number
  winRate: number | null
  maxDrawdownPct: number
  currentBankroll: number
  dailyProfit: Map<string, number>
}

function simulate(bets: CandidateBet[], stakingMethod: StakingMethod, caps: StakingCaps): SimResult {
  let bankroll = STARTING_BANKROLL
  const dailyProfit = new Map<string, number>()
  const forStats: WalletBetForStats[] = []

  for (const bet of bets) {
    const stake = recommendedStake(stakingMethod, bankroll, bet.decimalOdds, bet.modelProbability, caps)
    if (stake <= 0) continue
    const { profit } = settleBet({ stake, decimalOdds: bet.decimalOdds }, bet.outcome)
    bankroll += profit
    const day = melbourneDateKey(bet.placedAt)
    dailyProfit.set(day, (dailyProfit.get(day) ?? 0) + profit)
    forStats.push({ stake, decimalOdds: bet.decimalOdds, edgePoints: bet.edgePoints, result: bet.outcome, profit })
  }

  const stats = computeWalletStats(STARTING_BANKROLL, forStats)
  return {
    netProfit: stats.netProfit,
    roiPct: stats.roiPct,
    numberOfBets: stats.numberOfBets,
    numberSettled: stats.numberSettled,
    winRate: stats.winRate,
    maxDrawdownPct: stats.maxDrawdownPct,
    currentBankroll: stats.currentBankroll,
    dailyProfit,
  }
}

interface GridResult {
  thresholds: RecommendationThresholds
  stakingMethod: StakingMethod
  caps: StakingCaps
  sim: SimResult
}

function formatThresholds(t: RecommendationThresholds): string {
  return `edge>=${t.minEdgePoints} conf>=${t.minConfidenceLevel} age<=${t.maxPriceAgeSeconds}s feat>=${t.minFeatureCompleteness} jump[${t.minMinutesToJump},${t.maxMinutesToJump}]min`
}

function formatDaily(daily: Map<string, number>): string {
  return [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, profit]) => `${day}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`).join(', ')
}

async function main() {
  const client = new PuntersEdgeClient()
  console.log(`PuntersEdge client mode: ${client.isDemoMode ? 'DEMO SANDBOX (no real key - results() will fail)' : 'LIVE'}`)

  console.log('Fetching final results for the last 48 hours...')
  const resultsByRaceId = await fetchAllResults(client)
  console.log(`Loaded ${resultsByRaceId.size} final race results`)

  const raceIds = [...resultsByRaceId.keys()]
  console.log('Loading recorded recommendation snapshots for these races...')
  const groups = await loadRunnerGroups(raceIds, resultsByRaceId)
  const withOutcome = groups.filter((g) => g.winOutcome || g.placeOutcome)
  console.log(`Loaded ${groups.length} runner groups (${withOutcome.length} with a matching final result)`)
  if (withOutcome.length === 0) {
    console.log('No usable data - nothing to optimize. Exiting.')
    return
  }

  // Baseline: today's actual production defaults, to show the current (broken-for-$50) behavior.
  const { DEFAULT_THRESHOLDS } = await import('../src/lib/betting/recommendation-engine')
  const { DEFAULT_STAKING_CAPS } = await import('../src/lib/betting/kelly')
  const baselineBets = qualifyingBets(withOutcome, DEFAULT_THRESHOLDS)
  const baselineSim = simulate(baselineBets, 'flat-1pct', DEFAULT_STAKING_CAPS)
  console.log(`\n=== BASELINE (current production defaults, flat-1pct staking, $${STARTING_BANKROLL} bankroll) ===`)
  console.log(`${formatThresholds(DEFAULT_THRESHOLDS)} | caps maxStakePct=${DEFAULT_STAKING_CAPS.maxStakePct} minStake=$${DEFAULT_STAKING_CAPS.minStake}`)
  console.log(`Qualifying bets found: ${baselineBets.length}, actually staked (stake>0): ${baselineSim.numberOfBets}, net profit: $${baselineSim.netProfit.toFixed(2)}`)

  const edgeGrid = [10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 50]
  const confGrid: ConfidenceLevel[] = ['VERY_LOW', 'LOW']
  const priceAgeGrid = [60, 600]
  const featCompGrid = [0]
  const minJumpGrid = [0, 1]
  const maxJumpGrid = [120, 180, 240]
  const stakingMethods: StakingMethod[] = ['flat-1pct', 'flat-2pct', 'kelly-0.10', 'kelly-0.25']
  const maxStakePctGrid = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]
  const minStakeGrid = [0.5, 1]

  const totalThresholdCombos = edgeGrid.length * confGrid.length * priceAgeGrid.length * featCompGrid.length * minJumpGrid.length * maxJumpGrid.length
  console.log(`\nSearching ${totalThresholdCombos} threshold combos x ${stakingMethods.length * maxStakePctGrid.length * minStakeGrid.length} staking combos...`)

  const MIN_BETS_FOR_CONSIDERATION = 8
  const allResults: GridResult[] = []
  let combosEvaluated = 0
  let thresholdCombosEvaluated = 0
  const startTime = Date.now()

  for (const minEdgePoints of edgeGrid) {
    for (const minConfidenceLevel of confGrid) {
      for (const maxPriceAgeSeconds of priceAgeGrid) {
        for (const minFeatureCompleteness of featCompGrid) {
          for (const minMinutesToJump of minJumpGrid) {
            for (const maxMinutesToJump of maxJumpGrid) {
              const thresholds: RecommendationThresholds = { minEdgePoints, minConfidenceLevel, maxPriceAgeSeconds, minFeatureCompleteness, minMinutesToJump, maxMinutesToJump, maxOdds: Infinity }
              const bets = qualifyingBets(withOutcome, thresholds)
              thresholdCombosEvaluated += 1
              if (thresholdCombosEvaluated % 200 === 0) {
                console.log(`  ...${thresholdCombosEvaluated}/${totalThresholdCombos} threshold combos (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`)
              }
              if (bets.length === 0) continue

              for (const stakingMethod of stakingMethods) {
                for (const maxStakePct of maxStakePctGrid) {
                  for (const minStake of minStakeGrid) {
                    const caps: StakingCaps = { maxStakePct, minStake, maxAbsoluteStake: 100 }
                    const sim = simulate(bets, stakingMethod, caps)
                    combosEvaluated += 1
                    if (sim.numberOfBets < MIN_BETS_FOR_CONSIDERATION) continue
                    allResults.push({ thresholds, stakingMethod, caps, sim })
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`Evaluated ${combosEvaluated} total combos in ${((Date.now() - startTime) / 1000).toFixed(1)}s (${allResults.length} met the >=${MIN_BETS_FOR_CONSIDERATION}-bet sample floor)`)

  if (allResults.length === 0) {
    console.log(`\nNo config produced >=${MIN_BETS_FOR_CONSIDERATION} settled bets from this 2-day sample - the dataset is too thin to responsibly optimize on. Try again once more history has accumulated.`)
    return
  }

  allResults.sort((a, b) => b.sim.netProfit - a.sim.netProfit)
  const top = allResults.slice(0, 15)

  console.log(`\n=== TOP ${top.length} CONFIGS BY NET PROFIT (starting bankroll $${STARTING_BANKROLL}) ===`)
  top.forEach((r, i) => {
    console.log(`\n#${i + 1}: net profit $${r.sim.netProfit.toFixed(2)} (ROI ${r.sim.roiPct.toFixed(1)}%), ${r.sim.numberOfBets} bets, win rate ${r.sim.winRate != null ? (r.sim.winRate * 100).toFixed(0) + '%' : 'n/a'}, max drawdown ${r.sim.maxDrawdownPct.toFixed(1)}%`)
    console.log(`  thresholds: ${formatThresholds(r.thresholds)}`)
    console.log(`  staking: ${r.stakingMethod}, maxStakePct=${r.caps.maxStakePct}, minStake=$${r.caps.minStake}`)
    console.log(`  daily: ${formatDaily(r.sim.dailyProfit)}`)
  })

  const best = top[0]
  console.log(`\n=== WINNING CONFIG ===`)
  console.log(JSON.stringify({ thresholds: best.thresholds, stakingMethod: best.stakingMethod, caps: best.caps, sim: { ...best.sim, dailyProfit: Object.fromEntries(best.sim.dailyProfit) } }, null, 2))
}

main().catch((error) => {
  console.error('Optimization script failed:', error)
  process.exit(1)
})
