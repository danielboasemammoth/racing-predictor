import { describe, expect, it } from 'vitest'
import { predictContextualRace, type HistoricalStart, type RaceContext } from '@/lib/prediction-v3'
import type { Horse, RaceEntryWithHorse } from '@/lib/types'

const race: RaceContext = {
  id: 'target',
  racecourseId: 'caulfield',
  raceDatetime: '2026-08-15T04:00:00Z',
  distanceM: 1200,
  trackCondition: 'Soft 7',
  raceClass: 'BM78',
}

function entry(name: string): RaceEntryWithHorse {
  const id = name.toLowerCase()
  const horse: Horse = { id, name }
  return {
    id: `entry-${id}`,
    race_id: race.id,
    horse_id: id,
    barrier_number: 3,
    weight_carried: 58,
    jockey: `Jockey ${name}`,
    trainer: `Trainer ${name}`,
    status: 'running',
    horses: horse,
  }
}

function start(horseId: string, overrides: Partial<HistoricalStart> = {}): HistoricalStart {
  return {
    raceId: `past-${horseId}`,
    horseId,
    racecourseId: 'caulfield',
    raceDatetime: '2026-08-01T04:00:00Z',
    distanceM: 1200,
    trackCondition: 'Soft 6',
    raceClass: 'BM78',
    finishingPosition: 1,
    fieldSize: 10,
    barrier: 3,
    weight: 58,
    jockey: `Jockey ${horseId[0].toUpperCase()}${horseId.slice(1)}`,
    trainer: `Trainer ${horseId[0].toUpperCase()}${horseId.slice(1)}`,
    ...overrides,
  }
}

describe('v3 contextual ranking', () => {
  it('keeps odds outside prediction probabilities', () => {
    const entries = [entry('Alpha'), entry('Beta')]
    const history = [start('alpha'), start('beta', { finishingPosition: 5 })]
    const withoutOdds = predictContextualRace({ race, entries, history })
    const withOdds = predictContextualRace({
      race,
      entries,
      history,
      oddsByHorse: { alpha: { win: 50, place: 10 }, beta: { win: 1.2, place: 1.05 } },
    })

    expect(withOdds.predictions.all_horses.map((horse) => horse.win_probability))
      .toEqual(withoutOdds.predictions.all_horses.map((horse) => horse.win_probability))
    expect(withOdds.predictions.value_opportunities?.[0].horse_id).toBe('alpha')
  })

  it('ignores results occurring after the target race', () => {
    const entries = [entry('Alpha'), entry('Beta')]
    const history = [start('alpha'), start('beta', { finishingPosition: 5 })]
    const baseline = predictContextualRace({ race, entries, history })
    const withFutureResult = predictContextualRace({
      race,
      entries,
      history: [...history, start('beta', {
        raceId: 'future',
        raceDatetime: '2026-08-20T04:00:00Z',
        finishingPosition: 1,
      })],
    })

    expect(withFutureResult.predictions.all_horses).toEqual(baseline.predictions.all_horses)
  })

  it('rewards form achieved under matching distance and conditions', () => {
    const entries = [entry('Alpha'), entry('Beta'), entry('Gamma')]
    const result = predictContextualRace({
      race,
      entries,
      history: [
        start('alpha', { finishingPosition: 2 }),
        start('beta', { finishingPosition: 1, distanceM: 2400, trackCondition: 'Good 3', raceClass: 'Maiden' }),
        start('gamma', { finishingPosition: 7 }),
      ],
    })

    expect(result.predictions.podium[0].horse_id).toBe('alpha')
    expect(result.predictions.all_horses.reduce((sum, horse) => sum + (horse.win_probability ?? 0), 0)).toBeCloseTo(1)
    expect(result.predictions.all_horses.map((horse) => horse.win_probability ?? 0))
      .toEqual([...result.predictions.all_horses].map((horse) => horse.win_probability ?? 0).sort((left, right) => right - left))
    expect(result.predictions.feature_snapshots?.alpha).toBeDefined()
    expect(result.predictions.trifecta?.fair_return_10).toBeGreaterThan(0)
  })
})
