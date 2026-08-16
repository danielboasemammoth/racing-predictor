import { describe, expect, it } from 'vitest'
import { PRODUCTION_ENSEMBLE_CONFIGS, runEnsemble } from '@/lib/prediction-suite'
import type { RaceEntryWithHorse } from '@/lib/types'

const entries: RaceEntryWithHorse[] = [
  { id: 'a', race_id: 'race', horse_id: 'alpha', status: 'running', barrier_number: 2, weight_carried: 58, horses: { id: 'alpha', name: 'Alpha' } },
  { id: 'b', race_id: 'race', horse_id: 'beta', status: 'running', barrier_number: 8, weight_carried: 56, horses: { id: 'beta', name: 'Beta' } },
  { id: 'c', race_id: 'race', horse_id: 'gamma', status: 'running', barrier_number: 12, weight_carried: 55, horses: { id: 'gamma', name: 'Gamma' } },
]

const input = {
  race: {
    id: 'race',
    racecourseId: 'course',
    raceDatetime: '2026-08-16T05:00:00Z',
    distanceM: 1400,
    trackCondition: 'Soft 6',
    raceClass: 'BM64',
  },
  entries,
  history: [],
  fieldSize: entries.length,
}

describe('prediction suite ensemble', () => {
  it('averages every configured model into a normalized, transparent result', () => {
    const result = runEnsemble(input)
    const probabilityTotal = result.predictions.all_horses.reduce(
      (sum, horse) => sum + (horse.win_probability ?? 0),
      0,
    )

    expect(probabilityTotal).toBeCloseTo(1)
    expect(result.confidence_scores.winner).toBe(result.predictions.podium[0].win_probability)
    expect(result.predictions.model_components).toHaveLength(PRODUCTION_ENSEMBLE_CONFIGS.length)
    expect(result.predictions.model_components?.map((component) => component.model_version))
      .toEqual(PRODUCTION_ENSEMBLE_CONFIGS.map((config) => config.version))
    expect(result.predictions.model_agreement?.model_count).toBe(PRODUCTION_ENSEMBLE_CONFIGS.length)
  })
})
