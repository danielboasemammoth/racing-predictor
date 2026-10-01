import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyPick } from '../daily-picks'
import { getTabPricesForInternalRaces } from '../paper-betting/internal-tab-odds'
import { recordSimulationDecision } from './simulation-decision'
import { DEFAULT_SIMULATION_FILTERS, isSimulationDecisionQuote, matchesSimulationFilters, simulationCandidates, type SimulationRace } from './historical-simulator'

const start = '2026-10-01T03:00:00Z'
const decision = '2026-10-01T02:30:00.000Z'
const quotedAt = '2026-10-01T02:29:00Z'
const capturedAt = '2026-10-01T02:29:30Z'

vi.mock('../paper-betting/internal-tab-odds', () => ({ getTabPricesForInternalRaces: vi.fn() }))

function captureFixture(existing = false, createdAt = '2026-10-01T02:00:00Z') {
  const runner = { horse_id: 'horse', horse_name: 'Test', predicted_position: 1, confidence: 0.5, win_probability: 0.5, top3_probability: 0.8 }
  const pick = { horse: runner, reliability: { score: 85, classification: 'Average', vetoReason: null }, race: {
    id: 'race', race_number: 1, racecourses: { name: 'Test' }, status: 'upcoming', race_datetime: start,
    prediction: { id: 'forecast', model_version: 'model', predicted_at: '2026-10-01T02:00:00Z', predictions: { podium: [runner], all_horses: [runner] } },
  } } as DailyPick
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn()
    .mockResolvedValueOnce({ data: existing ? { kind: 'existing' } : null, error: null })
    .mockResolvedValueOnce({ data: { created_at: createdAt }, error: null }),
  upsert: vi.fn(() => ({ select: vi.fn().mockResolvedValue({ data: [{ kind: 'new' }], error: null }) })) }
  const admin = { from: vi.fn(() => query) } as unknown as SupabaseClient
  vi.mocked(getTabPricesForInternalRaces).mockReset().mockResolvedValue(new Map([['race', new Map([['test', { win: 3, place: 2, quotedAt, capturedAt }]])]]))
  return { pick, admin, query }
}

it('freezes one forecast and current quote per race/model using insert-only conflict handling', async () => {
  const { pick, admin, query } = captureFixture()
  expect(await recordSimulationDecision(admin, pick, new Set(['horse']), new Date(decision))).toBe(true)
  expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'simulator-decision-v1:race:model', generated_at: decision,
    payload: expect.objectContaining({ prices: { horse: { win: 3, place: 2, quotedAt, capturedAt } }, forecast: expect.objectContaining({ id: 'forecast', createdAt: '2026-10-01T02:00:00Z', evidence: expect.objectContaining({ qualifiedWin: true }) }) }) }), { onConflict: 'kind', ignoreDuplicates: true })
  expect(getTabPricesForInternalRaces).toHaveBeenCalledWith(admin, [expect.objectContaining({ racecourseName: 'Test' })], false, decision)
  const repeat = captureFixture(true)
  expect(await recordSimulationDecision(repeat.admin, repeat.pick, new Set(['horse']), new Date(decision))).toBe(false)
  expect(repeat.query.upsert).not.toHaveBeenCalled()
  expect(getTabPricesForInternalRaces).not.toHaveBeenCalled()
})

it('does not freeze missing prices, future-created forecasts or changed fields', async () => {
  const missing = captureFixture()
  vi.mocked(getTabPricesForInternalRaces).mockResolvedValue(new Map())
  expect(await recordSimulationDecision(missing.admin, missing.pick, new Set(['horse']), new Date(decision))).toBe(false)
  expect(missing.query.upsert).not.toHaveBeenCalled()
  const future = captureFixture(false, '2026-10-01T02:31:00Z')
  expect(await recordSimulationDecision(future.admin, future.pick, new Set(['horse']), new Date(decision))).toBe(false)
  expect(future.query.upsert).not.toHaveBeenCalled()
  const changed = captureFixture()
  expect(await recordSimulationDecision(changed.admin, changed.pick, new Set(['other']), new Date(decision))).toBe(false)
  expect(changed.query.upsert).not.toHaveBeenCalled()
})

it('requires a fresh quote already captured in the pre-race decision window', () => {
  expect(isSimulationDecisionQuote(start, decision, quotedAt, capturedAt)).toBe(true)
  for (const values of [
    [decision, '2026-10-01T02:27:59Z', capturedAt],
    [decision, quotedAt, '2026-10-01T02:30:01Z'],
    [decision, capturedAt, quotedAt],
    [start, quotedAt, capturedAt],
    [undefined, quotedAt, capturedAt],
  ]) expect(isSimulationDecisionQuote(start, ...values as [string?, string?, string?])).toBe(false)
})

it('keeps decision observations out of default portfolios and excludes missing provenance', () => {
  const race: SimulationRace = { id: 'race', start, settledAt: start, venue: 'Test', state: 'VIC', number: 1, fieldSize: 8, selections: [], decisionSelections: [{
    id: 'horse', horse: 'Test', model: 'model', rank: 1, predictedAt: '2026-10-01T02:00:00Z', evaluatedAt: decision,
    winProbability: 0.5, top3Probability: 0.8, reliability: 85, winOdds: 3, placeOdds: 2, winSource: 'tab_decision', placeSource: 'tab_decision',
    tabQuotedAt: quotedAt, tabCapturedAt: capturedAt, position: 1, scratched: false, winIssue: null, placeIssue: null,
  }] }
  const bet = simulationCandidates([race])[0]
  expect(bet.issue).toBeNull()
  expect(matchesSimulationFilters(bet, DEFAULT_SIMULATION_FILTERS)).toBe(false)
  expect(matchesSimulationFilters(bet, { ...DEFAULT_SIMULATION_FILTERS, source: 'tab_decision' })).toBe(true)
  race.decisionSelections![0].tabQuotedAt = undefined
  expect(simulationCandidates([race])[0].issue).toContain('decision time')
})