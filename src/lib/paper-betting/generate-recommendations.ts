/**
 * MVP "model" for the value engine: a cross-bookmaker no-vig consensus probability, compared
 * against TAB's own price. This is deliberately NOT a fundamentals model - there is no matched
 * historical dataset yet for either code via PuntersEdge (see repo notes). It is an honest,
 * defensible baseline: "does TAB's price disagree with what the wider market believes?" Blending
 * in the existing horse fundamentals model (prediction-suite.ts) or a genuine greyhound
 * fundamentals model are tracked as future work, not faked here.
 */
import { buildRunnerMarketView } from '@/lib/puntersedge/tab-extraction'
import { noVigProbabilities } from '@/lib/betting/odds-math'
import { deriveConfidence, type ConfidenceLevel } from '@/lib/betting/confidence'
import { DEFAULT_THRESHOLDS, recommend, type Decision, type RecommendationThresholds } from '@/lib/betting/recommendation-engine'
import { harvilleTop3Probabilities } from '@/lib/betting/harville'
import type { PeNextToGoRace } from '@/lib/puntersedge/types'

export const MARKET_CONSENSUS_MODEL_VERSION = 'market-consensus-v1'

export interface PlaceRecommendation {
  modelProbability: number
  decision: Decision
  edgePoints: number | null
  expectedValueRatio: number | null
  reasons: string[]
  failedCriteria: string[]
}

export interface RunnerRecommendation {
  runnerNumber: number
  runnerName: string
  scratched: boolean
  tabWinPrice: number | null
  tabPlacePrice: number | null
  tabAgeSeconds: number | null
  bestPrice: number | null
  medianPrice: number | null
  numBookmakers: number
  modelProbability: number | null
  featureCompleteness: number
  confidenceLevel: ConfidenceLevel
  decision: Decision
  edgePoints: number | null
  expectedValueRatio: number | null
  reasons: string[]
  failedCriteria: string[]
  /** Harville-derived top-3 probability vs TAB place price - null when there's no win model probability or no TAB place price. */
  place: PlaceRecommendation | null
}

export interface GenerateRecommendationsOptions {
  now: Date
  thresholds?: RecommendationThresholds
  /** From real settled-bet history via calibration.ts; 0 until enough paper bets exist. */
  calibrationSampleSize?: number
  /** From real settled-bet history; 0.5 (neutral) until enough paper bets exist to measure it. */
  historicalCalibration?: number
}

const DISPERSION_DISAGREEMENT_SCALE = 0.05 // 5 percentage points of implied-probability stdev treated as high disagreement

function marketAgreementFactor(dispersion: number | undefined): number {
  if (dispersion == null) return 0
  return Math.max(0, Math.min(1, 1 - dispersion / DISPERSION_DISAGREEMENT_SCALE))
}

export function generateRaceRecommendations(race: PeNextToGoRace, options: GenerateRecommendationsOptions): RunnerRecommendation[] {
  // The unauthenticated demo sandbox truncates optional fields (scratchings, runners) entirely
  // rather than sending empty arrays - default defensively so demo mode never throws.
  // Verified live: a runner's `number` can also be null (program number not yet resolved by
  // PuntersEdge's upstream source) even with barrier/trainer/form present - such runners can't be
  // tracked or bet on without a stable number, so they're excluded rather than crashing or guessing.
  const scratchedNumbers = new Set((race.scratchings ?? []).map((s) => s.number))
  const minutesToJump = (new Date(race.start_time).getTime() - options.now.getTime()) / 60_000
  const raceStarted = minutesToJump <= 0

  const views = (race.runners ?? [])
    .filter((runner): runner is typeof runner & { number: number } => runner.number != null)
    .map((runner) => ({ runner, view: buildRunnerMarketView(runner) }))
  const referencePrices = views.map(({ view }) => view.consensus?.medianPrice ?? view.tab?.winPrice ?? null)
  const validIndices = referencePrices.map((p, i) => (p != null ? i : -1)).filter((i) => i >= 0)
  const noVigField = noVigProbabilities(validIndices.map((i) => referencePrices[i] as number))
  const modelProbabilityByIndex = new Map<number, number>()
  validIndices.forEach((originalIndex, position) => modelProbabilityByIndex.set(originalIndex, noVigField[position]))

  // Harville top-3 probabilities computed over the same priced subset of the field - see
  // src/lib/betting/harville.ts for the approximation this makes (always top-3, not the exact
  // number of places TAB actually pays for this field size).
  const harvilleField = harvilleTop3Probabilities(noVigField)
  const placeProbabilityByIndex = new Map<number, number>()
  validIndices.forEach((originalIndex, position) => placeProbabilityByIndex.set(originalIndex, harvilleField[position]))

  return views.map(({ runner, view }, index) => {
    const scratched = scratchedNumbers.has(runner.number)
    const modelProbability = modelProbabilityByIndex.get(index) ?? null
    const featureCompleteness = view.consensus ? Math.min(1, view.consensus.numBookmakers / 5) : 0

    const confidence = deriveConfidence({
      dataCompleteness: featureCompleteness,
      calibrationSampleSize: options.calibrationSampleSize ?? 0,
      modelAgreement: 0.5, // single model, not an ensemble yet - deliberately neutral, never inflated
      historicalCalibration: options.historicalCalibration ?? 0.5,
      marketAgreement: marketAgreementFactor(view.consensus?.probabilityDispersion),
      priceAgeSeconds: view.tab?.ageSeconds ?? Number.POSITIVE_INFINITY,
    })

    const recommendation =
      modelProbability == null
        ? { decision: 'NO_BET' as Decision, edgePoints: null, expectedValueRatio: null, reasons: [], failedCriteria: ['no market price available for this runner'] }
        : recommend(
            {
              modelProbability,
              tabPrice: view.tab?.winPrice ?? null,
              tabPriceAgeSeconds: view.tab?.ageSeconds ?? null,
              confidenceLevel: confidence.level,
              minutesToJump,
              isScratched: scratched,
              raceStarted,
              featureCompleteness,
            },
            options.thresholds ?? DEFAULT_THRESHOLDS,
          )

    const placeModelProbability = placeProbabilityByIndex.get(index) ?? null
    const place: PlaceRecommendation | null =
      placeModelProbability == null || view.tab?.placePrice == null
        ? null
        : {
            modelProbability: placeModelProbability,
            ...recommend(
              {
                modelProbability: placeModelProbability,
                tabPrice: view.tab.placePrice,
                tabPriceAgeSeconds: view.tab?.ageSeconds ?? null,
                confidenceLevel: confidence.level, // reuses the win market's confidence - not separately derived
                minutesToJump,
                isScratched: scratched,
                raceStarted,
                featureCompleteness,
              },
              options.thresholds ?? DEFAULT_THRESHOLDS,
            ),
          }

    return {
      runnerNumber: runner.number,
      runnerName: runner.name,
      scratched,
      tabWinPrice: view.tab?.winPrice ?? null,
      tabPlacePrice: view.tab?.placePrice ?? null,
      tabAgeSeconds: view.tab?.ageSeconds ?? null,
      bestPrice: view.consensus?.bestPrice ?? null,
      medianPrice: view.consensus?.medianPrice ?? null,
      numBookmakers: view.consensus?.numBookmakers ?? 0,
      modelProbability,
      featureCompleteness,
      confidenceLevel: confidence.level,
      decision: recommendation.decision,
      edgePoints: recommendation.edgePoints,
      expectedValueRatio: recommendation.expectedValueRatio,
      reasons: recommendation.reasons,
      failedCriteria: recommendation.failedCriteria,
      place,
    } satisfies RunnerRecommendation
  })
}
