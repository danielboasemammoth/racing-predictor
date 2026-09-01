/**
 * DRIFT DETECTION: compares a recent window of settled bets against a long-term baseline and
 * flags meaningful deterioration - calibration (Brier score), ROI, edge-to-return conversion,
 * and prediction-distribution shift. Thresholds are conservative and documented so a flag means
 * something, not just sampling noise; both windows must clear MIN_CREDIBLE_SAMPLE before any
 * flag is raised.
 */
import { brierScore, type CalibrationSample } from '@/lib/betting/calibration'

export interface DriftBetSample extends CalibrationSample {
  profit: number
  stake: number
  edgePoints: number | null
}

export interface WindowSummary {
  n: number
  brierScore: number | null
  roiPct: number
  avgEdgePoints: number | null
  avgModelProbability: number | null
}

export interface DriftFlag {
  metric: 'calibration' | 'roi' | 'edge_conversion' | 'prediction_distribution'
  message: string
}

export interface DriftReport {
  recentWindow: WindowSummary
  baselineWindow: WindowSummary
  flags: DriftFlag[]
  sufficientData: boolean
}

const MIN_CREDIBLE_SAMPLE = 30

// Deliberately conservative - only flags a genuinely large swing, not routine variance.
const BRIER_DETERIORATION_THRESHOLD = 0.03
const ROI_DETERIORATION_POINTS = 15
const PROBABILITY_SHIFT_THRESHOLD = 0.1

function summarizeWindow(bets: DriftBetSample[]): WindowSummary {
  if (bets.length === 0) {
    return { n: 0, brierScore: null, roiPct: 0, avgEdgePoints: null, avgModelProbability: null }
  }
  const totalStaked = bets.reduce((sum, b) => sum + b.stake, 0)
  const totalProfit = bets.reduce((sum, b) => sum + b.profit, 0)
  const edges = bets.map((b) => b.edgePoints).filter((e): e is number => e != null)
  return {
    n: bets.length,
    brierScore: brierScore(bets),
    roiPct: totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0,
    avgEdgePoints: edges.length > 0 ? edges.reduce((s, v) => s + v, 0) / edges.length : null,
    avgModelProbability: bets.reduce((s, b) => s + b.modelProbability, 0) / bets.length,
  }
}

/** Both windows should be disjoint (e.g. recent = last 50, baseline = everything before that). */
export function detectDrift(recentBets: DriftBetSample[], baselineBets: DriftBetSample[]): DriftReport {
  const recentWindow = summarizeWindow(recentBets)
  const baselineWindow = summarizeWindow(baselineBets)
  const sufficientData = recentWindow.n >= MIN_CREDIBLE_SAMPLE && baselineWindow.n >= MIN_CREDIBLE_SAMPLE

  const flags: DriftFlag[] = []
  if (sufficientData) {
    if (recentWindow.brierScore != null && baselineWindow.brierScore != null && recentWindow.brierScore - baselineWindow.brierScore > BRIER_DETERIORATION_THRESHOLD) {
      flags.push({
        metric: 'calibration',
        message: `Brier score worsened from ${baselineWindow.brierScore.toFixed(4)} (baseline) to ${recentWindow.brierScore.toFixed(4)} (recent) - probabilities are less well-calibrated than before`,
      })
    }

    if (baselineWindow.roiPct - recentWindow.roiPct > ROI_DETERIORATION_POINTS) {
      flags.push({
        metric: 'roi',
        message: `ROI dropped from ${baselineWindow.roiPct.toFixed(1)}% (baseline) to ${recentWindow.roiPct.toFixed(1)}% (recent)`,
      })
    }

    if (
      recentWindow.avgEdgePoints != null &&
      baselineWindow.avgEdgePoints != null &&
      recentWindow.avgEdgePoints >= baselineWindow.avgEdgePoints - 1 && // edge held up...
      baselineWindow.roiPct - recentWindow.roiPct > ROI_DETERIORATION_POINTS // ...but ROI still fell
    ) {
      flags.push({
        metric: 'edge_conversion',
        message: 'Average edge is holding steady but ROI has fallen - the model\'s claimed edge is no longer converting into real returns',
      })
    }

    if (
      recentWindow.avgModelProbability != null &&
      baselineWindow.avgModelProbability != null &&
      Math.abs(recentWindow.avgModelProbability - baselineWindow.avgModelProbability) > PROBABILITY_SHIFT_THRESHOLD
    ) {
      flags.push({
        metric: 'prediction_distribution',
        message: `Average model probability shifted from ${(baselineWindow.avgModelProbability * 100).toFixed(1)}% (baseline) to ${(recentWindow.avgModelProbability * 100).toFixed(1)}% (recent) - the model is recommending materially different kinds of bets`,
      })
    }
  }

  return { recentWindow, baselineWindow, flags, sufficientData }
}
