/**
 * Champion model (audit spec Parts 10/15/41/47) - PROMOTED 2026-09-09, see
 * prediction-suite.ts::PRODUCTION_MODEL_VERSION and MODEL_PROMOTION.md for the evidence trail.
 * The pure fundamentals ensemble (v4.1-ensemble) uses zero market information; a chronological
 * discovery/holdout experiment (scripts/experiment-market-reranker.ts, 2026-09) found the raw
 * market favourite alone beats it by roughly 2x on genuine holdout winner accuracy (38.5% vs
 * 22.4%), and accuracy fell monotonically as more weight was put on the fundamentals model at
 * every tested blend ratio. This model blends the ensemble's own probability with the race's
 * normalized market-implied probability (from Racing.com's own recorded price feed - NOT a
 * confirmed TAB/Betfair price), predominantly toward the market. It is generated and stored every
 * time the fundamentals ensemble is, so v4.1-ensemble remains available for comparison on
 * /accuracy even though it is no longer the primary pick.
 */
import { normalizedMarketProbabilities } from '@/lib/reliability-analysis'
import type { ModelSuiteResult } from '@/lib/prediction-suite'
import type { PredictedHorse, PredictionPayload } from '@/lib/types'

export const MARKET_BLEND_MODEL_VERSION = 'v6-market-blend'
// alpha = weight on the fundamentals model; (1 - alpha) = weight on normalized market probability.
// alpha=0.0 and alpha=0.1 tied for best on the discovery slice (37.4%); alpha=0.0 (pure market)
// was marginally best on the untouched holdout (33.8% vs 33.8% - alpha=0.1 not separately
// re-verified there). 0.1 keeps a token fundamentals contribution rather than zeroing the
// production model out entirely on the strength of one holdout run - re-tune once this
// challenger has its own live track record (spec Part 45).
export const MARKET_BLEND_ALPHA = 0.1

/** Runners without a recorded win_odds keep their fundamentals-only probability (no market signal to blend). */
export function runMarketBlendModel(fundamentals: ModelSuiteResult): ModelSuiteResult {
  const field = fundamentals.predictions.all_horses
  const priced = field.filter((h): h is PredictedHorse & { win_odds: number } => Boolean(h.win_odds))
  const normalized = normalizedMarketProbabilities(priced.map((h) => h.win_odds))
  const marketProbByHorse = new Map(priced.map((h, i) => [h.horse_id, normalized[i]]))

  const blendedRaw = field.map((horse) => {
    const fundamentalsProb = horse.win_probability ?? horse.confidence
    const marketProb = marketProbByHorse.get(horse.horse_id)
    const blendedProb = marketProb != null ? MARKET_BLEND_ALPHA * fundamentalsProb + (1 - MARKET_BLEND_ALPHA) * marketProb : fundamentalsProb
    return { horse, blendedProb }
  })
  const total = blendedRaw.reduce((sum, b) => sum + b.blendedProb, 0)

  // top3_probability is inherited from the fundamentals model unchanged (no market top-3/place
  // signal is blended in) - it can be inconsistent with the reordered win ranking below; a known,
  // documented limitation of this first-generation challenger, not a silent bug.
  const allHorses: PredictedHorse[] = blendedRaw
    .map(({ horse, blendedProb }) => {
      const normalizedProb = total > 0 ? blendedProb / total : blendedProb
      return { ...horse, win_probability: normalizedProb, confidence: normalizedProb }
    })
    .sort((a, b) => (b.win_probability ?? 0) - (a.win_probability ?? 0) || a.horse_name.localeCompare(b.horse_name))
    .map((horse, index) => ({ ...horse, predicted_position: index + 1 }))

  const podium = allHorses.slice(0, 3)
  const predictions: PredictionPayload = {
    ...fundamentals.predictions,
    podium,
    all_horses: allHorses,
    model_components: [
      {
        model_version: MARKET_BLEND_MODEL_VERSION,
        winner_horse_id: podium[0]?.horse_id ?? '',
        winner_horse_name: podium[0]?.horse_name ?? '',
        winner_confidence: podium[0]?.win_probability ?? 0,
        podium_horse_ids: podium.map((horse) => horse.horse_id),
      },
    ],
  }
  const winner = podium[0]?.win_probability ?? 0

  return {
    modelVersion: MARKET_BLEND_MODEL_VERSION,
    predictions,
    confidence_scores: {
      overall: winner,
      winner,
      podium: podium.reduce((sum, horse) => sum + (horse.top3_probability ?? 0), 0) / Math.max(podium.length, 1),
    },
    predicted_times: fundamentals.predicted_times,
  }
}
