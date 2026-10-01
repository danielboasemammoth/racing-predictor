import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, expect, it } from 'vitest'

const db = new PGlite()
const raceId = '00000000-0000-0000-0000-000000000001'
const courseId = '00000000-0000-0000-0000-000000000002'
const horseId = '00000000-0000-0000-0000-000000000003'
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table public.racecourses(id uuid primary key, name text, state text);
    create table public.races(id uuid primary key, racecourse_id uuid, race_number int, race_datetime timestamptz, status text, updated_at timestamptz);
    create table public.race_entries(race_id uuid, horse_id uuid, finishing_position int, status text, updated_at timestamptz);
    create table public.predictions(id uuid primary key, race_id uuid, model_version text, predicted_at timestamptz, created_at timestamptz, predictions jsonb);
    create table public.analysis_snapshots(kind text unique, payload jsonb, generated_at timestamptz);
  `)
  await db.exec(readFileSync(resolve('supabase/migrate-historical-simulator.sql'), 'utf8'))
  await db.query('insert into public.racecourses values ($1, $2, $3)', [courseId, 'Test', 'VIC'])
  await db.query("insert into public.races values ($1, $2, 1, '2026-01-01T01:00:00Z', 'completed', '2026-01-01T02:00:00Z')", [raceId, courseId])
  await db.query("insert into public.race_entries values ($1, $2, 1, 'finished', '2026-01-01T02:00:00Z')", [raceId, horseId])
  for (const [index, model, predicted, created] of [
    [4, 'model', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'],
    [5, 'model', '2026-01-01T00:30:00Z', '2026-01-01T00:30:00Z'],
    [6, 'model', '2026-01-01T02:00:00Z', '2026-01-01T02:00:00Z'],
    [7, 'model', '2026-01-01T00:59:00Z', '2026-01-01T02:00:00Z'],
    [8, 'model-retrospective', '2026-01-01T00:59:00Z', '2026-01-01T00:59:00Z'],
  ]) {
    await db.query('insert into public.predictions values ($1, $2, $3, $4, $5, $6)', [`00000000-0000-0000-0000-00000000000${index}`, raceId, model, predicted, created, JSON.stringify({ podium: [{ horse_id: horseId }], all_horses: [{ horse_id: horseId }] })])
  }
}, 30000)
afterAll(async () => { await db.close() })

it('selects only the latest actually-created pre-race forecast', async () => {
  const result = await db.query<{ source: { forecasts: Array<{ id: string; model: string }> } }>('select public.simulation_race_sources($1, $2) as source', [[raceId], ['model', 'model-retrospective']])
  expect(result.rows[0].source.forecasts).toHaveLength(1)
  expect(result.rows[0].source.forecasts[0].id).toBe('00000000-0000-0000-0000-000000000005')
})

it('detects result corrections even when update timestamps and row counts do not change', async () => {
  const before = await db.query<{ fingerprint: string }>('select * from public.simulation_race_window()')
  await db.query('update public.race_entries set finishing_position = 2 where race_id = $1', [raceId])
  const after = await db.query<{ fingerprint: string }>('select * from public.simulation_race_window()')
  expect(before.rows[0].fingerprint).not.toBe(after.rows[0].fingerprint)
})

it('enforces batch bounds and prevents anonymous source reads', async () => {
  await expect(db.query('select public.simulation_race_sources($1, $2)', [Array(21).fill(raceId), ['model']])).rejects.toThrow('batch limit')
  await db.exec('set role anon')
  try { await expect(db.query('select * from public.simulation_race_window()')).rejects.toThrow('permission denied') }
  finally { await db.exec('reset role') }
})

it('serializes report publishers and allows recovery after lease expiry', async () => {
  const first = await db.query<{ acquired: boolean }>('select public.acquire_reporting_lease($1, $2) as acquired', ['test', raceId])
  const second = await db.query<{ acquired: boolean }>('select public.acquire_reporting_lease($1, $2) as acquired', ['test', courseId])
  expect(first.rows[0].acquired).toBe(true)
  expect(second.rows[0].acquired).toBe(false)
  await db.exec("update public.reporting_job_leases set expires_at = now() - interval '1 minute'")
  const recovered = await db.query<{ acquired: boolean }>('select public.acquire_reporting_lease($1, $2) as acquired', ['test', courseId])
  expect(recovered.rows[0].acquired).toBe(true)
})

it('fingerprints the newest genuinely pre-race creation, ignoring later backdated inserts', async () => {
  const before = await db.query<{ fingerprint: string }>('select * from public.simulation_race_window()')
  await db.query("insert into public.predictions values ($1, $2, 'model', '2026-01-01T00:59:30Z', '2026-01-01T00:59:30Z', '{}'::jsonb)", ['00000000-0000-0000-0000-000000000009', raceId])
  const changed = await db.query<{ fingerprint: string }>('select * from public.simulation_race_window()')
  expect(changed.rows[0].fingerprint).not.toBe(before.rows[0].fingerprint)
  await db.query("insert into public.predictions values ($1, $2, 'model', '2026-01-01T00:50:00Z', '2026-01-01T03:00:00Z', '{}'::jsonb)", ['00000000-0000-0000-0000-000000000010', raceId])
  const unchanged = await db.query<{ fingerprint: string }>('select * from public.simulation_race_window()')
  expect(unchanged.rows[0].fingerprint).toBe(changed.rows[0].fingerprint)
})