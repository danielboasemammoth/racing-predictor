'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Stage 1 testing tool: places a simulated bet against a manually-entered "current market" snapshot, since no real Betfair market data feed is wired up yet (Stage 2+). Runs the real risk engine + staking + commission pipeline. */
export function SimulateBetForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    marketId: 'TEST-MARKET-1',
    selectionId: 'TEST-SEL-1',
    runnerName: 'Example Runner',
    racingCode: 'horse' as 'horse' | 'greyhound' | 'harness',
    venue: '',
    state: 'VIC',
    currentBestPrice: 4.2,
    availableLiquidity: 200,
    minutesToJump: 10,
    modelProbability: 0.285,
    confidence: 0.7,
    marketBaseRate: 0.08,
    stakeOverride: 0,
  })
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle')
  const [result, setResult] = useState<string>()

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit() {
    setStatus('pending')
    setResult(undefined)
    try {
      const response = await fetch('/api/betfair/bets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          venue: form.venue || null,
          modelVersion: 'stage1-manual-test',
          stakeOverride: form.stakeOverride > 0 ? form.stakeOverride : undefined,
        }),
      })
      const payload = (await response.json()) as { success: boolean; decision?: string; reasons?: string[]; message?: string; stake?: number; status?: string }
      setStatus('idle')
      if (!response.ok || !payload.success) {
        setResult(payload.message ?? 'Failed')
        return
      }
      if (payload.decision === 'NO_BET') {
        setResult(`NO BET: ${(payload.reasons ?? []).join('; ')}`)
      } else {
        setResult(`BET placed: $${payload.stake?.toFixed(2)} (${payload.status})`)
        router.refresh()
      }
    } catch {
      setStatus('error')
      setResult('Could not reach the server')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Text label="Runner name" value={form.runnerName} onChange={(v) => set('runnerName', v)} />
        <Text label="Venue" value={form.venue} onChange={(v) => set('venue', v)} />
        <Text label="State" value={form.state} onChange={(v) => set('state', v)} />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Code
          <select value={form.racingCode} onChange={(e) => set('racingCode', e.target.value as typeof form.racingCode)} className="rounded border border-slate-300 px-2 py-1 text-sm">
            <option value="horse">Horse</option>
            <option value="greyhound">Greyhound</option>
            <option value="harness">Harness</option>
          </select>
        </label>
        <Num label="Current Betfair price" value={form.currentBestPrice} onChange={(v) => set('currentBestPrice', v)} />
        <Num label="Available liquidity ($)" value={form.availableLiquidity} onChange={(v) => set('availableLiquidity', v)} />
        <Num label="Minutes to jump" value={form.minutesToJump} onChange={(v) => set('minutesToJump', v)} />
        <Num label="Model probability (0-1)" value={form.modelProbability} onChange={(v) => set('modelProbability', v)} />
        <Num label="Confidence (0-1)" value={form.confidence} onChange={(v) => set('confidence', v)} />
        <Num label="Market base rate (0-1)" value={form.marketBaseRate} onChange={(v) => set('marketBaseRate', v)} />
        <Num label="Manual stake override ($, 0 = use staking method)" value={form.stakeOverride} onChange={(v) => set('stakeOverride', v)} />
      </div>
      <button type="button" onClick={submit} disabled={status === 'pending'} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {status === 'pending' ? 'Evaluating…' : 'Evaluate & Place Simulated Bet'}
      </button>
      {result && <p className="text-xs text-slate-700">{result}</p>}
    </div>
  )
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
    </label>
  )
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input type="number" step="any" value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1 text-sm" />
    </label>
  )
}
