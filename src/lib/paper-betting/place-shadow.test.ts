import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RaceWithPrediction } from '@/lib/types'
import { createPlaceShadowSnapshot, loadPlaceShadowReport, recordPlaceShadow, resolvePlaceShadow, summarizePlaceShadow } from './place-shadow'

function fixture() {
  const horses = Array.from({ length: 8 }, (_, index) => ({ horse_id: `horse-${index}`, horse_name: `Horse ${index}`,
    confidence: 0.125, predicted_position: index + 1, top3_probability: index < 3 ? 0.7 : 0.18, place_odds: 2 }))
  const race = {
    id: 'race', race_datetime: '2026-09-16T03:00:00Z', status: 'upcoming',
    prediction: { model_version: 'v6-market-blend', predicted_at: '2026-09-16T01:00:00Z', predictions: { all_horses: horses, podium: horses.slice(0, 3) } },
  } as RaceWithPrediction
  return { race, active: new Set(horses.map((horse) => horse.horse_id)), now: new Date('2026-09-16T02:00:00Z'),
    entries: horses.map((horse, index) => ({ horse_id: horse.horse_id, status: 'active', finishing_position: index + 1 })) }
}

describe('prospective place shadow', () => {
  it('freezes both forecasts and price without mutating the production prediction', () => {
    const { race, active, now } = fixture()
    const before = structuredClone(race)
    const snapshot = createPlaceShadowSnapshot(race, active, now)!
    expect(snapshot.correctedProbabilities[0].probability).toBeLessThan(0.7)
    expect(race).toEqual(before)
    race.prediction!.predictions.all_horses[0].place_odds = 10
    expect(snapshot.prediction.predictions.all_horses[0].place_odds).toBe(2)
  })

  it('never overwrites the first captured forecast on repeated runs', async () => {
    const { race, active, now } = fixture()
    const query = { upsert: vi.fn().mockReturnThis(), select: vi.fn().mockResolvedValueOnce({ data: [{ id: 'row' }], error: null }).mockResolvedValueOnce({ data: [], error: null }) }
    const admin = { from: vi.fn(() => query) } as unknown as SupabaseClient
    expect(await recordPlaceShadow(admin, race, active, now)).toBe(true)
    expect(await recordPlaceShadow(admin, race, active, now)).toBe(false)
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'place-shrinkage-shadow-v1:race' }), { onConflict: 'kind', ignoreDuplicates: true })
  })

  it('rejects pre-experiment, late, changed-field and different-model capture', () => {
    const { race, active, now } = fixture()
    expect(createPlaceShadowSnapshot(race, active, new Date('2026-09-15T13:00:00Z'))).toBeNull()
    expect(createPlaceShadowSnapshot(race, active, new Date(race.race_datetime))).toBeNull()
    race.prediction!.model_version = 'other-model'
    expect(createPlaceShadowSnapshot(race, active, now)).toBeNull()
    race.prediction!.model_version = 'v6-market-blend'
    active.delete('horse-7')
    expect(createPlaceShadowSnapshot(race, active, now)).toBeNull()
  })

  it('scores actual results using the frozen forecasts and rejects later candidate edits', () => {
    const { race, active, now, entries } = fixture()
    const snapshot = createPlaceShadowSnapshot(race, active, now)!
    const resolved = resolvePlaceShadow(snapshot, race, entries)
    expect(resolved.sample?.runners.filter((runner) => runner.placed)).toHaveLength(3)
    snapshot.correctedProbabilities[0].probability = 0.99
    expect(resolvePlaceShadow(snapshot, race, entries).reason).toBe('changed_shadow_candidate')
  })

  it('does not claim evidence before any outcomes exist', () => {
    expect(summarizePlaceShadow([])).toMatchObject({ probabilityReviewReady: false, selectedValueReviewReady: false, productionChanged: false })
  })

  it('reads stored snapshots and separates completed, pending, and changed fields', async () => {
    const { race, active, now, entries } = fixture()
    const snapshot = createPlaceShadowSnapshot(race, active, now)!
    const pending = { ...snapshot, race: { ...snapshot.race, id: 'pending' } }
    const changed = { ...snapshot, race: { ...snapshot.race, id: 'changed' } }
    const snapshotsQuery = { select: vi.fn().mockReturnThis(), like: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [snapshot, pending, changed].map((payload) => ({ payload })), error: null }) }
    const raceQuery = { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [
      { ...race, status: 'completed' }, { ...race, id: 'pending' }, { ...race, id: 'changed', status: 'completed' },
    ], error: null }) }
    const entriesQuery = { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [
      ...entries.map((entry) => ({ ...entry, race_id: 'race' })),
      ...entries.slice(0, 7).map((entry) => ({ ...entry, race_id: 'changed' })),
    ], error: null }) }
    const admin = { from: vi.fn((table: string) => table === 'analysis_snapshots' ? snapshotsQuery : table === 'races' ? raceQuery : entriesQuery) } as unknown as SupabaseClient
    const report = await loadPlaceShadowReport(admin)
    expect(report).toMatchObject({ captured: 3, pending: 1, raw: { races: 1 }, corrected: { races: 1 }, exclusions: { not_three_place_field: 1 } })
  })
})