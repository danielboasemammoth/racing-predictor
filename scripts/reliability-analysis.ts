/**
 * Discovery pass over historical completed races: tests the reliability-spec hypotheses
 * (distance, race type, field size, barrier, track, probability, gap, agreement, and
 * interactions) and reports which ones actually hold up out-of-sample.
 *
 * The actual load/compute/publish work (loading completed races, building analysis rows,
 * computing the calibration table, and publishing both snapshots to Supabase) lives in
 * `src/lib/reliability-refresh.ts` so it can ALSO run as a scheduled admin action
 * (`/api/admin/reliability-refresh`, wired into the daily pipeline) - this script is now a thin
 * wrapper that calls the same shared function and additionally prints the full discovery/holdout
 * diagnostic report for a human to review. Discovery vs production: the segment-by-segment
 * breakdown below is for a human (or a later step) to review - only probability/gap/agreement are
 * validated and fed into the published calibration table; a newly discovered segment pattern must
 * be validated before it's allowed to affect production scoring (per spec).
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  type BucketStats,
  MIN_CREDIBLE_SAMPLE,
  agreementBand,
  bucketize,
  distanceBand,
  fieldSizeBand,
  marketImpliedProbability,
  modelEdge,
  modelEdgeBand,
  predictionGapBand,
  probabilityBand,
} from '../src/lib/reliability-analysis'
import { computeReliabilityScore, reliabilityCalibrationBands, type CalibrationTable } from '../src/lib/reliability-score'
import { flatStakeReport } from '../src/lib/roi-analysis'
import { refreshReliabilityCalibration, type RaceAnalysisRow } from '../src/lib/reliability-refresh'
import { createScriptClient } from './supabase-client'

config({ path: '.env.local' })

const supabase = createScriptClient()

function reportBuckets(title: string, buckets: BucketStats[]) {
  console.log(`\n## ${title}`)
  for (const bucket of buckets) {
    if (bucket.n < 5) continue
    const flag = bucket.n < MIN_CREDIBLE_SAMPLE ? ' (small sample - shrunk toward baseline)' : bucket.significant ? ' **SIGNIFICANT**' : ''
    console.log(
      `  ${bucket.label.padEnd(16)} n=${String(bucket.n).padEnd(5)} strike=${(bucket.strikeRate * 100).toFixed(1)}%`
      + ` (95% CI ${(bucket.ciLow * 100).toFixed(1)}-${(bucket.ciHigh * 100).toFixed(1)}%) shrunk=${(bucket.shrunkStrikeRate * 100).toFixed(1)}%`
      + ` baseline=${(bucket.baseline * 100).toFixed(1)}% lift=${(bucket.lift * 100).toFixed(1)}pts${flag}`,
    )
  }
}

function analyzeSlice(label: string, rows: RaceAnalysisRow[]) {
  console.log(`\n=========================================================`)
  console.log(`${label}: ${rows.length} races, overall strike rate ${((rows.filter((r) => r.correctWinner).length / rows.length) * 100).toFixed(1)}%`)

  reportBuckets('Distance', bucketize(rows, (r) => distanceBand(r.distanceM), (r) => r.correctWinner))
  reportBuckets('Race type', bucketize(rows, (r) => r.raceType, (r) => r.correctWinner))
  reportBuckets('Field size', bucketize(rows, (r) => fieldSizeBand(r.fieldSize), (r) => r.correctWinner))
  reportBuckets('Barrier third', bucketize(rows.filter((r) => r.barrierThird), (r) => r.barrierThird!, (r) => r.correctWinner))
  reportBuckets('Track condition', bucketize(rows.filter((r) => r.trackCondition), (r) => r.trackCondition!, (r) => r.correctWinner))
  reportBuckets('Model probability', bucketize(rows, (r) => probabilityBand(r.probability), (r) => r.correctWinner))
  reportBuckets('Prediction gap (#1 vs #2)', bucketize(rows, (r) => predictionGapBand(r.gap), (r) => r.correctWinner))
  reportBuckets('Model agreement', bucketize(rows, (r) => agreementBand(r.agreeing, r.totalBaseModels), (r) => r.correctWinner))

  // Interactions called out explicitly in the spec.
  reportBuckets('Barrier third x distance <=1200m', bucketize(
    rows.filter((r) => r.barrierThird && r.distanceM != null && r.distanceM <= 1200),
    (r) => r.barrierThird!,
    (r) => r.correctWinner,
  ))
  reportBuckets('Barrier third x distance >1600m', bucketize(
    rows.filter((r) => r.barrierThird && r.distanceM != null && r.distanceM > 1600),
    (r) => r.barrierThird!,
    (r) => r.correctWinner,
  ))
  reportBuckets('Maiden x distance', bucketize(
    rows.filter((r) => r.raceType === 'maiden' || r.raceType === 'super-maiden'),
    (r) => distanceBand(r.distanceM),
    (r) => r.correctWinner,
  ))
  reportBuckets('Unanimous agreement x gap', bucketize(
    rows.filter((r) => agreementBand(r.agreeing, r.totalBaseModels) === 'unanimous'),
    (r) => predictionGapBand(r.gap),
    (r) => r.correctWinner,
  ))
  reportBuckets('Track venue (shrinkage applies to small samples)', bucketize(rows, (r) => r.racecourseId, (r) => r.correctWinner))
}

/** Spec section 28: verify higher Reliability Scores correspond to genuinely higher strike rates. */
function reportCalibrationMonotonicity(rows: RaceAnalysisRow[], calibration: CalibrationTable, history: RaceAnalysisRow[]) {
  console.log('\n## Reliability Score calibration (spec section 28 - should read monotonically top to bottom)')
  console.log('  Band       Races   Wins   Strike Rate')
  for (const band of reliabilityCalibrationBands(rows, calibration, history)) {
    console.log(`  ${band.label.padEnd(10)} ${String(band.n).padEnd(7)} ${String(band.wins).padEnd(6)} ${(band.strikeRate * 100).toFixed(1)}%`)
  }
}

/**
 * Spec sections 25-26: flat-stake profitability, overall and by Model Edge band. IMPORTANT:
 * odds here are the best price recorded in Racing.com's own feed, not a confirmed TAB Fixed Win
 * or Betfair SP - this project has no market-data integration yet. Treat as an approximation.
 */
function reportProfitability(rows: RaceAnalysisRow[], calibration: CalibrationTable, history: RaceAnalysisRow[]) {
  const withOdds = rows.filter((r): r is RaceAnalysisRow & { bestRecordedOdds: number } => r.bestRecordedOdds !== null)
  console.log(`\n## Flat-stake profitability (${withOdds.length}/${rows.length} races had a recorded price; NOT confirmed TAB/Betfair)`)

  const overall = flatStakeReport(withOdds.map((r) => ({ won: r.correctWinner, odds: r.bestRecordedOdds })))
  console.log(
    `  Overall: ${overall.bets} bets, ROI ${(overall.roi * 100).toFixed(1)}%, profit factor ${overall.profitFactor?.toFixed(2) ?? 'n/a'},`
    + ` max drawdown ${overall.maxDrawdown.toFixed(1)} units, longest losing streak ${overall.longestLosingStreak}`,
  )

  console.log('\n  By Model Edge (model probability - implied probability from recorded price):')
  const edgeGroups = Map.groupBy(withOdds, (r) => modelEdgeBand(modelEdge(r.probability, marketImpliedProbability(r.bestRecordedOdds))))
  for (const [label, group] of edgeGroups) {
    if (group.length < 5) continue
    const report = flatStakeReport(group.map((r) => ({ won: r.correctWinner, odds: r.bestRecordedOdds })))
    console.log(`    ${label.padEnd(14)} n=${String(group.length).padEnd(5)} ROI ${(report.roi * 100).toFixed(1)}%`)
  }

  console.log('\n  By Reliability Score band:')
  const scoreGroups = Map.groupBy(withOdds, (r) => {
    const score = computeReliabilityScore({ probability: r.probability, gap: r.gap, agreeing: r.agreeing, totalBaseModels: r.totalBaseModels }, calibration, history).score
    if (score >= 80) return '80+'
    if (score >= 65) return '65-79'
    if (score >= 50) return '50-64'
    return '<50'
  })
  for (const [label, group] of scoreGroups) {
    if (group.length < 5) continue
    const report = flatStakeReport(group.map((r) => ({ won: r.correctWinner, odds: r.bestRecordedOdds })))
    console.log(`    ${label.padEnd(14)} n=${String(group.length).padEnd(5)} ROI ${(report.roi * 100).toFixed(1)}%`)
  }
}

async function main() {
  console.log('Loading completed races, entries, and retrospective predictions, and publishing calibration...')
  const { rows, validationEnd, calibration, historyPayload } = await refreshReliabilityCalibration(supabase)
  console.log(`Built ${rows.length} analyzable races and published both snapshots to Supabase (analysis_snapshots table).`)

  const discovery = rows.slice(0, validationEnd) // train + validation, per spec section 27
  const holdout = rows.slice(validationEnd) // most recent 15%, never used for pattern discovery

  analyzeSlice('DISCOVERY (first 85% chronologically)', discovery)
  analyzeSlice('HOLDOUT (most recent 15%, untouched until now)', holdout)

  mkdirSync('scripts/output', { recursive: true })
  writeFileSync('scripts/output/reliability-calibration.json', JSON.stringify(calibration, null, 2))
  console.log('\nWrote scripts/output/reliability-calibration.json (production calibration table: probability/gap/agreement only).')

  reportCalibrationMonotonicity(rows, calibration, rows)
  reportProfitability(rows, calibration, rows)

  writeFileSync('scripts/output/reliability-analysis-rows.json', JSON.stringify(historyPayload, null, 2))
  console.log('\nWrote scripts/output/reliability-analysis-rows.json for downstream use (Reliability Score weighting, similarity engine).')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Reliability analysis failed')
  process.exitCode = 1
})
