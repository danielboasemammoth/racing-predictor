import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyPick } from '../daily-picks'
import { isQualifiedSimulationWin, recordSimulationEvidence } from './simulation-evidence'

const pick = { horse: { horse_id: 'horse' }, reliability: { score: 85, classification: 'Average', vetoReason: null }, race: {
  id: 'race', status: 'upcoming', race_datetime: '2026-10-02T02:00:00Z', prediction: { id: 'prediction', model_version: 'v6-market-blend', predicted_at: '2026-10-02T00:00:00Z', predictions: { podium: [{ horse_id: 'horse' }], all_horses: [{ horse_id: 'horse' }] } },
} } as DailyPick

it('freezes first pre-race evaluation without placing a bet or overwriting it', async () => {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const admin = { from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient
  expect(await recordSimulationEvidence(admin, pick, new Set(['horse']), new Date('2026-10-02T01:00:00Z'))).toBe(true)
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'simulator-evidence-v1:prediction', payload: expect.objectContaining({ qualifiedWin: true, reliability: 85 }) }), { onConflict: 'kind', ignoreDuplicates: true })
  expect(await recordSimulationEvidence(admin, pick, new Set(['horse']), new Date('2026-10-02T02:01:00Z'))).toBe(false)
  expect(await recordSimulationEvidence(admin, pick, new Set(['different']), new Date('2026-10-02T01:00:00Z'))).toBe(false)
  expect(isQualifiedSimulationWin({ ...pick, reliability: { ...pick.reliability!, vetoReason: 'Insufficient evidence' } })).toBe(false)
  expect(upsert).toHaveBeenCalledTimes(1)
})