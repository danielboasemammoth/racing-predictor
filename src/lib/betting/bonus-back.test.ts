import { expect, it, vi } from 'vitest'
import { bonusBackCredit, bonusBackEligible, bonusBackProbability, isBonusBackOffer, recordPaperBonusClaim, type BonusBackOffer } from './bonus-back'

const offer: BonusBackOffer = { raceId: 'race', runnerId: 'horse', runnerName: 'Runner', confirmedAt: '2026-10-11T02:00:00Z', startsAt: '2026-10-11T03:00:00Z', cap: 50, basis: 'manual' }

it('awards a capped non-cash credit only for losing WIN bets finishing second or third', () => {
  expect(bonusBackCredit(100, 50, 'LOST', 2)).toBe(50)
  expect(bonusBackCredit(10, 50, 'LOST', 3)).toBe(10)
  expect(bonusBackCredit(0.29, 50, 'LOST', 2)).toBe(0.29)
  expect(bonusBackCredit(50, 8.03, 'LOST', 3)).toBe(8.03)
  expect(bonusBackCredit(1.999, 50, 'LOST', 2)).toBe(1.99)
  for (const status of ['WON', 'PENDING', 'SCRATCHED', 'VOID', 'ABANDONED']) expect(bonusBackCredit(10, 50, status, 2)).toBe(0)
  for (const finish of [null, 0, 1, 4]) expect(bonusBackCredit(10, 50, 'LOST', finish)).toBe(0)
  expect(bonusBackCredit(10, 51, 'LOST', 2)).toBe(0)
})

it('requires matching runner and race with pre-race confirmation known at placement', () => {
  expect(bonusBackEligible(offer, 'race', 'horse', 'WIN', '2026-10-11T02:30:00Z')).toBe(true)
  for (const placedAt of [undefined, 'invalid', '2026-10-11T01:59:59Z', '2026-10-11T03:00:00Z']) expect(bonusBackEligible(offer, 'race', 'horse', 'WIN', placedAt)).toBe(false)
  expect(bonusBackEligible(offer, 'race', 'other', 'WIN', '2026-10-11T02:30:00Z')).toBe(false)
  expect(bonusBackEligible(offer, 'other', 'horse', 'WIN', '2026-10-11T02:30:00Z')).toBe(false)
  expect(bonusBackEligible(offer, 'race', 'horse', 'PLACE', '2026-10-11T02:30:00Z')).toBe(false)
  expect(bonusBackEligible(undefined, 'race', 'horse', 'WIN', '2026-10-11T02:30:00Z')).toBe(false)
})

it('rejects invalid caps and retrospective confirmations', () => {
  expect(isBonusBackOffer(offer)).toBe(true)
  expect(isBonusBackOffer({ ...offer, confirmedAt: offer.startsAt })).toBe(false)
  for (const cap of [0, -1, 51, NaN]) expect(isBonusBackOffer({ ...offer, cap })).toBe(false)
})

it('separates the second/third-place probability from the win probability', () => {
  expect(bonusBackProbability(0.3, 0.7)).toBeCloseTo(0.4)
  expect(bonusBackProbability(0.7, 0.3)).toBeNull()
  expect(bonusBackProbability(undefined, 0.7)).toBeNull()
})

it('records at most the first qualifying TAB WIN bet per account/race and never touches the cash ledger', async () => {
  const stored = new Map<string, unknown>()
  const upsert = vi.fn(async (row: { kind: string; payload: unknown }, options: { ignoreDuplicates: boolean }) => {
    if (!stored.has(row.kind) || !options.ignoreDuplicates) stored.set(row.kind, row.payload)
    return { error: null }
  })
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { payload: offer }, error: null }), upsert }
  const from = vi.fn(() => query)
  const db = { from } as never
  const input = { accountId: 'account', betId: 'first', raceId: 'race', runnerId: 'horse', market: 'WIN', source: 'internal', oddsSource: 'tab', stake: 10, placedAt: '2026-10-11T02:30:00Z' }
  await recordPaperBonusClaim(db, input)
  await recordPaperBonusClaim(db, { ...input, betId: 'second' })
  expect(stored.size).toBe(1)
  expect([...stored.values()][0]).toMatchObject({ betId: 'first', stake: 10, offer })
  expect(from.mock.calls.every(([table]) => table === 'analysis_snapshots')).toBe(true)
  expect(upsert).toHaveBeenLastCalledWith(expect.any(Object), { onConflict: 'kind', ignoreDuplicates: true })
  upsert.mockClear()
  for (const overrides of [{ oddsSource: 'recorded' }, { market: 'PLACE' }, { source: 'puntersedge' }, { placedAt: '2026-10-11T01:00:00Z' }, { runnerId: 'other' }]) await recordPaperBonusClaim(db, { ...input, ...overrides })
  expect(upsert).not.toHaveBeenCalled()
})