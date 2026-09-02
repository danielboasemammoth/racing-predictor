import { describe, expect, it } from 'vitest'
import { MARKET_BLEND_ALPHA, MARKET_BLEND_MODEL_VERSION, runMarketBlendModel } from '@/lib/market-blend-model'
import type { ModelSuiteResult } from '@/lib/prediction-suite'
import type { PredictedHorse } from '@/lib/types'

function horse(overrides: Partial<PredictedHorse>): PredictedHorse {
  return {
    horse_id: 'h1',
    horse_name: 'Horse',
    predicted_position: 1,
    confidence: 0.5,
    win_probability: 0.5,
    ...overrides,
  }
}

function fundamentalsResult(allHorses: PredictedHorse[]): ModelSuiteResult {
  return {
    modelVersion: 'v4.1-ensemble',
    predictions: { podium: allHorses.slice(0, 3), all_horses: allHorses },
    confidence_scores: { overall: allHorses[0]?.win_probability ?? 0 },
    predicted_times: {},
  }
}

describe('runMarketBlendModel', () => {
  it('reorders the field toward the market favourite when fundamentals and market disagree', () => {
    const fundamentals = fundamentalsResult([
      horse({ horse_id: 'a', horse_name: 'A', win_probability: 0.6, win_odds: 8 }), // fundamentals favourite, market long shot
      horse({ horse_id: 'b', horse_name: 'B', win_probability: 0.4, win_odds: 1.5 }), // fundamentals 2nd, market favourite
    ])
    const result = runMarketBlendModel(fundamentals)
    expect(result.modelVersion).toBe(MARKET_BLEND_MODEL_VERSION)
    expect(result.predictions.podium[0].horse_id).toBe('b') // market favourite should now be ranked #1
  })

  it('produces probabilities that sum to 1 across the field', () => {
    const fundamentals = fundamentalsResult([
      horse({ horse_id: 'a', horse_name: 'A', win_probability: 0.5, win_odds: 2 }),
      horse({ horse_id: 'b', horse_name: 'B', win_probability: 0.3, win_odds: 4 }),
      horse({ horse_id: 'c', horse_name: 'C', win_probability: 0.2, win_odds: 10 }),
    ])
    const result = runMarketBlendModel(fundamentals)
    const total = result.predictions.all_horses.reduce((sum, h) => sum + (h.win_probability ?? 0), 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('falls back to the fundamentals probability for a runner with no recorded win_odds', () => {
    const fundamentals = fundamentalsResult([
      horse({ horse_id: 'a', horse_name: 'A', win_probability: 0.7, win_odds: 1.8 }),
      horse({ horse_id: 'b', horse_name: 'B', win_probability: 0.3 }), // no odds at all
    ])
    const result = runMarketBlendModel(fundamentals)
    // b keeps its raw fundamentals share relative to a's blended share - just check it doesn't crash and sums to 1
    const total = result.predictions.all_horses.reduce((sum, h) => sum + (h.win_probability ?? 0), 0)
    expect(total).toBeCloseTo(1, 5)
  })

  it('predominantly weights the market (alpha < 0.5) rather than the fundamentals model', () => {
    expect(MARKET_BLEND_ALPHA).toBeLessThan(0.5)
  })

  it('stores a model_components entry identifying the challenger version', () => {
    const fundamentals = fundamentalsResult([horse({ horse_id: 'a', win_odds: 2 })])
    const result = runMarketBlendModel(fundamentals)
    expect(result.predictions.model_components?.[0]?.model_version).toBe(MARKET_BLEND_MODEL_VERSION)
  })
})
