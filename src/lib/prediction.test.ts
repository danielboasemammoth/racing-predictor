import { describe, expect, it } from 'vitest'
import { predictRace } from '@/lib/prediction'
import type { Horse, RaceEntryWithHorse } from '@/lib/types'

function entry(name: string, stats: Partial<Horse> = {}): RaceEntryWithHorse {
  const horseId = name.toLowerCase().replaceAll(' ', '-')
  return {
    id: `entry-${horseId}`,
    race_id: 'race-1',
    horse_id: horseId,
    barrier_number: 5,
    status: 'running',
    horses: {
      id: horseId,
      name,
      ...stats,
    },
  }
}

describe('predictRace', () => {
  it('ranks stronger career form first and normalizes probabilities', () => {
    const result = predictRace([
      entry('Consistent', { career_runs: 20, career_wins: 7, career_places: 12 }),
      entry('Unproven', { career_runs: 20, career_wins: 1, career_places: 3 }),
    ])

    expect(result.predictions.podium[0].horse_name).toBe('Consistent')
    const probabilityTotal = result.predictions.all_horses.reduce(
      (sum, horse) => sum + horse.confidence,
      0,
    )
    expect(probabilityTotal).toBeCloseTo(1)
    expect(result.confidence_scores.overall).toBe(result.confidence_scores.winner)
  })

  it('uses the rating that matches the track condition', () => {
    const wetSpecialist = entry('Wet Specialist', { wet_form_rating: 0.9, dry_form_rating: 0.1 })
    const drySpecialist = entry('Dry Specialist', { wet_form_rating: 0.1, dry_form_rating: 0.9 })

    expect(predictRace([wetSpecialist, drySpecialist], 'Soft 6').predictions.podium[0].horse_name)
      .toBe('Wet Specialist')
    expect(predictRace([wetSpecialist, drySpecialist], 'Good 4').predictions.podium[0].horse_name)
      .toBe('Dry Specialist')
  })

  it('excludes entries that have no horse record', () => {
    const missingHorse: RaceEntryWithHorse = {
      id: 'entry-missing',
      race_id: 'race-1',
      horse_id: 'missing',
      status: 'running',
      horses: null,
    }

    const result = predictRace([missingHorse, entry('Known Horse')])

    expect(result.predictions.all_horses).toHaveLength(1)
    expect(result.predictions.all_horses[0].horse_name).toBe('Known Horse')
  })
})