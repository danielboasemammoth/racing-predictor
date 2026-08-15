import { describe, expect, it } from 'vitest'
import { evaluatePrediction } from '@/lib/backtest'
import type { PredictionPayload } from '@/lib/types'

const prediction: PredictionPayload = {
  podium: [
    { horse_id: 'a', horse_name: 'A', predicted_position: 1, confidence: 0.5 },
    { horse_id: 'b', horse_name: 'B', predicted_position: 2, confidence: 0.3 },
    { horse_id: 'c', horse_name: 'C', predicted_position: 3, confidence: 0.2 },
  ],
  all_horses: [],
}

describe('evaluatePrediction', () => {
  it('scores the winner and an unordered exact podium', () => {
    const outcome = evaluatePrediction(prediction, {}, [
      { horse_id: 'a', finishing_position: 1, finishing_time: 70 },
      { horse_id: 'c', finishing_position: 2, finishing_time: 71 },
      { horse_id: 'b', finishing_position: 3, finishing_time: 72 },
    ])

    expect(outcome).toMatchObject({
      correctWinner: true,
      correctPodium: true,
      orderedTrifecta: false,
      winnerTop3: true,
      podiumOverlap: 1,
      accuracyScore: 1,
    })
    expect(outcome?.winnerBrierScore).toBeGreaterThan(0)
    expect(outcome?.winnerLogLoss).toBeCloseTo(-Math.log(0.5))
  })

  it('calculates absolute finishing-time errors only for available predictions', () => {
    const outcome = evaluatePrediction(prediction, { a: 69.5, b: 73 }, [
      { horse_id: 'a', finishing_position: 1, finishing_time: 70 },
      { horse_id: 'b', finishing_position: 2, finishing_time: 72 },
      { horse_id: 'c', finishing_position: 3, finishing_time: 72.5 },
    ])

    expect(outcome?.timeErrors).toEqual([0.5, 1])
  })

  it('does not score races without a result', () => {
    expect(evaluatePrediction(prediction, {}, [
      { horse_id: 'a', finishing_position: null, finishing_time: null },
    ])).toBeNull()
  })
})