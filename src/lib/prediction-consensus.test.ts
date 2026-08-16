import { describe, expect, it } from 'vitest'
import { predictConsensusRace } from '@/lib/prediction-consensus'
import type { RaceEntryWithHorse } from '@/lib/types'

const entries: RaceEntryWithHorse[] = [
  {
    id: 'entry-alpha',
    race_id: 'race',
    horse_id: 'alpha',
    barrier_number: 1,
    status: 'running',
    horses: { id: 'alpha', name: 'Alpha', career_runs: 10, career_wins: 5 },
  },
  {
    id: 'entry-beta',
    race_id: 'race',
    horse_id: 'beta',
    barrier_number: 12,
    status: 'running',
    horses: { id: 'beta', name: 'Beta', career_runs: 10, career_wins: 1 },
  },
]

describe('consensus prediction', () => {
  it('reports agreement without inflating calibrated probability', () => {
    const result = predictConsensusRace({
      race: {
        id: 'race',
        racecourseId: 'course',
        raceDatetime: '2026-08-16T04:00:00Z',
        distanceM: 1200,
        trackCondition: 'Good 4',
        raceClass: 'BM64',
      },
      entries,
      history: [],
      fieldSize: entries.length,
    })

    expect(result.meta.cross_check_winner_agreement).toBeGreaterThan(0)
    expect(result.confidence_scores.winner).toBe(result.predictions.podium[0].win_probability)
    expect(result.meta.confidence_boost).toBe(0)
  })
})
