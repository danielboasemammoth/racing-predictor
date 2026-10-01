import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { readSimulationPreferences } from '../src/lib/betting/simulation-preferences'
import { buildRunnerConfig, DEFAULT_RISK_LIMITS, loopbackOrigin, parseRunnerConfig } from '../src/lib/real-betting/config'
import { strategyHash } from '../src/lib/real-betting/ledger'

async function main() {
  assert.ok(process.argv.includes('--record-dry-run'), 'Pass --record-dry-run to consent to one permanent, blocked test heartbeat')
  const appUrl = loopbackOrigin(process.argv[2])
  assert.ok(appUrl, 'Provide a loopback app origin as the first argument')
  const health = await fetch(`${appUrl}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
  assert.equal(health.status, 200)
  assert.equal((await health.json()).app, 'racing-predictor')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const configId = randomUUID()
  const now = new Date()
  const strategy = { schema: 1 as const, name: `Runner smoke test - no betting - ${now.toISOString()}`, savedAt: now.toISOString(), preferences: readSimulationPreferences(null) }
  const config = buildRunnerConfig(strategy, DEFAULT_RISK_LIMITS, configId, now)
  config.appUrl = appUrl
  const directory = await mkdtemp(join(tmpdir(), 'racing-runner-smoke-'))
  const configPath = join(directory, 'real-betting-runner.json')
  const runner = resolve('scripts/windows/run-real-betting.ps1')
  const run = (...extra: string[]) => {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', runner, '-ConfigPath', configPath, '-ProjectRoot', process.cwd(), ...extra], { encoding: 'utf8', timeout: 90_000 })
    console.log(output.trim())
  }
  const attempts = async () => {
    const result = await admin.from('real_betting_attempts').select('id, idempotency_key, kind, decision, proposed_market, proposed_stake, strategy_hash, strategy_snapshot, risk_limits, created_at').eq('config_id', configId)
    if (result.error) throw result.error
    return result.data
  }
  const betCount = async () => {
    const result = await admin.from('real_bets').select('id', { count: 'exact', head: true })
    if (result.error) throw result.error
    return result.count
  }
  try {
    const beforeBets = await betCount()
    await writeFile(configPath, JSON.stringify(config))
    run('-ValidateOnly')
    run()
    assert.equal((await attempts()).length, 0, 'Disabled execution must not write an attempt')
    config.mode = 'dry-run'
    assert.equal(parseRunnerConfig(config).ok, true)
    await writeFile(configPath, JSON.stringify(config))
    const slot = Math.floor(Date.now() / 900_000)
    run()
    const first = await attempts()
    assert.equal(first.length, 1, 'First run must create one heartbeat')
    assert.equal(first[0].kind, 'DRY_RUN')
    assert.equal(first[0].decision, 'BLOCKED_PROVIDER_DISCONNECTED')
    assert.equal(first[0].proposed_market, null)
    assert.equal(first[0].proposed_stake, null)
    assert.equal(first[0].strategy_hash, strategyHash(strategy))
    assert.deepEqual(first[0].strategy_snapshot, strategy)
    assert.deepEqual(first[0].risk_limits, config.limits)
    assert.equal(Math.floor(Date.now() / 900_000), slot, 'Slot changed; rerun the check in a stable quarter-hour slot')
    run()
    assert.equal(Math.floor(Date.now() / 900_000), slot, 'Slot changed during duplicate check; both slots may have legitimate heartbeats')
    const repeated = await attempts()
    assert.deepEqual(repeated, first, 'Repeated run must preserve exactly the same immutable record')
    assert.equal(await betCount(), beforeBets, 'Real bets must remain unchanged')
    console.log(JSON.stringify({ status: 'passed', configId, attemptId: first[0].id, idempotencyKey: first[0].idempotency_key, decision: first[0].decision, duplicatePrevented: true, realBetsUnchanged: true, createdAt: first[0].created_at }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })