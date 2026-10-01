import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

const db = new PGlite()
const hash = 'a'.repeat(64)
const migration = readFileSync(resolve('supabase/migrate-real-betting.sql'), 'utf8')

async function insertBet(key: string, extra = '') {
  return db.query(`insert into public.real_bets (idempotency_key, provider, strategy_name, strategy_hash, strategy_snapshot, risk_limits, quote_snapshot,
    race_ref, selection_ref, market, quoted_odds, quoted_at, stake${extra ? ', status, outcome, return_amount' : ''})
    values ($1, 'tab', 'Strategy', $2, '{}', '{}', '{"odds":3}', 'race', 'runner', 'WIN', 3, now(), 5${extra}) returning id`, [key, hash])
}

async function asRole<T>(role: string, action: () => Promise<T>) {
  await db.exec(`set role ${role}`)
  try { return await action() } finally { await db.exec('reset role') }
}

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(migration)
  await db.exec(migration)
}, 30000)
afterAll(async () => { await db.close() })

it('is idempotent and keeps both ledgers private to service_role', async () => {
  for (const role of ['anon', 'authenticated']) {
    await asRole(role, async () => {
      await expect(db.query('select * from public.real_bets')).rejects.toThrow('permission denied')
      await expect(db.query('select * from public.real_betting_attempts')).rejects.toThrow('permission denied')
    })
  }
  await asRole('service_role', async () => {
    await expect(insertBet('service-role-bet')).resolves.toBeTruthy()
    await expect(db.query('delete from public.real_betting_attempts')).rejects.toThrow('permission denied')
  })
})

it('enforces unique idempotency keys and provider order ids', async () => {
  await insertBet('duplicate-key')
  await expect(insertBet('duplicate-key')).rejects.toThrow('duplicate key')
  await db.query("update public.real_bets set provider_order_id = 'order-1', status = 'SUBMITTED', submitted_at = now() where idempotency_key = 'duplicate-key'")
  await insertBet('other-key')
  await expect(db.query("update public.real_bets set provider_order_id = 'order-1' where idempotency_key = 'other-key'")).rejects.toThrow('duplicate key')
})

it('cannot record WON or LOST without verified provider settlement', async () => {
  await expect(insertBet('fabricated-win', ", 'SETTLED', 'WON', 15")).rejects.toThrow('check constraint')
  await insertBet('pending-bet')
  await expect(db.query(`update public.real_bets set provider_order_id = 'order-p', status = 'SETTLED', outcome = 'WON', return_amount = 15, submitted_at = now(),
    accepted_at = now(), settled_at = now() where idempotency_key = 'pending-bet'`)).rejects.toThrow('real_bets_outcome_requires_verified_settlement')
  await expect(db.query("update public.real_bets set outcome = 'WON' where idempotency_key = 'pending-bet'")).rejects.toThrow('check constraint')
  await expect(insertBet('free-money', ", 'PENDING_SUBMISSION', null, 100")).rejects.toThrow('real_bets_return_requires_outcome')
})

it('keeps strategy, quote and stake immutable and settled bets final', async () => {
  await insertBet('immutable')
  await expect(db.query("update public.real_bets set stake = 50 where idempotency_key = 'immutable'")).rejects.toThrow('immutable')
  await expect(db.query(`update public.real_bets set quote_snapshot = '{"odds":9}' where idempotency_key = 'immutable'`)).rejects.toThrow('immutable')
  await expect(db.query("update public.real_bets set strategy_snapshot = '{\"x\":1}' where idempotency_key = 'immutable'")).rejects.toThrow('immutable')
  await db.query(`update public.real_bets set provider_order_id = 'order-2', status = 'SETTLED', outcome = 'LOST', return_amount = 0, accepted_at = now(), submitted_at = now(),
    provider_settlement_ref = 'settlement-2', settlement_verified_at = now(), settled_at = now() where idempotency_key = 'immutable'`)
  await expect(db.query("update public.real_bets set outcome = 'WON', return_amount = 15 where idempotency_key = 'immutable'")).rejects.toThrow('final')
  await expect(db.query("update public.real_bets set provider_order_id = 'order-3' where idempotency_key = 'duplicate-key'")).rejects.toThrow('cannot change')
  await expect(db.query("delete from public.real_bets where idempotency_key = 'immutable'")).rejects.toThrow('permanent')
})

it('stores only blocked, append-only DRY_RUN attempts with idempotent keys', async () => {
  const insert = (key: string, kind = 'DRY_RUN', decision = 'BLOCKED_PROVIDER_DISCONNECTED') => db.query(`insert into public.real_betting_attempts
    (kind, idempotency_key, provider, config_id, runner_version, strategy_name, strategy_hash, strategy_snapshot, risk_limits, decision, reason)
    values ($1, $2, 'tab', '11111111-2222-4333-8444-555555555555', '1', 'Strategy', $3, '{}', '{}', $4, 'disconnected')
    on conflict (idempotency_key) do nothing returning id`, [kind, key, hash, decision])
  const key = 'dry-run:11111111-2222-4333-8444-555555555555:202610010200'
  expect((await insert(key)).rows).toHaveLength(1)
  expect((await insert(key)).rows).toHaveLength(0)
  await expect(insert(key.replace('0200', '0215'), 'LIVE')).rejects.toThrow('check')
  await expect(insert(key.replace('0200', '0230'), 'DRY_RUN', 'PLACED')).rejects.toThrow('check')
  await expect(db.query("update public.real_betting_attempts set decision = 'BLOCKED_RISK_LIMIT'")).rejects.toThrow('append-only')
  await expect(db.query('delete from public.real_betting_attempts')).rejects.toThrow('append-only')
})
