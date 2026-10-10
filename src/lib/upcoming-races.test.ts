import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUpcomingRaces } from './upcoming-races'
import { CURRENT_MODEL_VERSIONS, PRODUCTION_MODEL_VERSION } from './prediction-suite'

function mockDatabase(raceCount: number, historyCopies = 1) {
  const races = Array.from({ length: raceCount }, (_, index) => ({ id: `race-${index}` }))
  const predictions = races.flatMap(race => Array.from({ length: historyCopies }, (_, copy) => copy).flatMap(copy => CURRENT_MODEL_VERSIONS.map(version => ({
    id: `${race.id}-${copy}-${version}`, race_id: race.id, model_version: version, predicted_at: `snapshot-${copy}`,
  })))).reverse()
  const raceQuery = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: races, error: null }),
  }
  const requests: Array<{ ids: string[]; start: number }> = []
  const payloadRequests: string[][] = []
  const from = vi.fn((table: string) => {
    if (table === 'races') return raceQuery
    let ids: string[] = []
    const query = {
      select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      in: vi.fn((field: string, values: string[]) => {
        if (field === 'id') {
          payloadRequests.push(values)
          return Promise.resolve({ data: predictions.filter(prediction => values.includes(prediction.id)), error: null })
        }
        if (field === 'race_id') ids = values
        return query
      }),
      range: vi.fn(async (start: number, end: number) => {
        requests.push({ ids, start })
        return { data: predictions.filter(prediction => ids.includes(prediction.race_id)).slice(start, end + 1), error: null }
      }),
    }
    return query
  })
  return { db: { from } as unknown as SupabaseClient, requests, payloadRequests, raceQuery }
}

describe('upcoming race model coverage', () => {
  it('includes elapsed start times only for schedule reconciliation, preserving the default betting window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T05:05:00Z'))
    try {
      const { db, raceQuery } = mockDatabase(0)
      await getUpcomingRaces(db, { includeElapsedToday: true })
      expect(raceQuery.gte).toHaveBeenLastCalledWith('race_datetime', '2026-10-09T13:00:00.000Z')
      await getUpcomingRaces(db)
      expect(raceQuery.gte).toHaveBeenLastCalledWith('race_datetime', '2026-10-10T05:05:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads all seven models across 180 races rather than truncating at 1000 predictions', async () => {
    const { db, requests } = mockDatabase(180)
    const races = await getUpcomingRaces(db)
    expect(races).toHaveLength(180)
    expect(races.every(race => race.prediction?.model_version === PRODUCTION_MODEL_VERSION)).toBe(true)
    expect(races.every(race => race.model_predictions?.length === CURRENT_MODEL_VERSIONS.length)).toBe(true)
    expect(requests).toHaveLength(9)
    expect(requests.every(request => request.ids.length <= 20)).toBe(true)
  })

  it('pages through repeated snapshots within a batch and keeps the newest model per race', async () => {
    const { db, requests, payloadRequests } = mockDatabase(20, 20)
    const races = await getUpcomingRaces(db)
    expect(requests.map(request => request.start)).toEqual([0, 1000, 2000])
    expect(races.every(race => race.model_predictions?.length === CURRENT_MODEL_VERSIONS.length)).toBe(true)
    expect(races.every(race => race.prediction?.predicted_at === 'snapshot-19')).toBe(true)
    expect(payloadRequests.flat()).toHaveLength(20 * CURRENT_MODEL_VERSIONS.length)
    expect(payloadRequests.every(ids => ids.length <= 20)).toBe(true)
  })

  it('does not query predictions when no races are scheduled', async () => {
    const { db, requests } = mockDatabase(0)
    expect(await getUpcomingRaces(db)).toEqual([])
    expect(requests).toEqual([])
  })
})