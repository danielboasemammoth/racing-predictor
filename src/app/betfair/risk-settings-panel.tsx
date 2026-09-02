'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface RiskSettingsPanelProps {
  minConfidence: number
  minEdgePct: number
  minOdds: number
  maxOdds: number
  minLiquidity: number
  maxBet: number
  maxPctBankroll: number
  maxTotalExposurePct: number
  maxDailyStake: number
  maxDailyLossPct: number
  maxBetsPerDay: number
  maxBetsPerRace: number
  minMinutesToJump: number
  maxMinutesToJump: number
  horseEnabled: boolean
  greyhoundEnabled: boolean
  nswThoroughbredAutoEnabled: boolean
  stakingMethod: string
  flatStakeAmount: number
  pctBankrollStake: number
}

const STAKING_METHODS = [
  { value: 'flat', label: 'Flat stake' },
  { value: 'pct-bankroll', label: '% of bankroll' },
  { value: 'kelly-0.10', label: '0.10 Kelly (conservative default)' },
  { value: 'kelly-0.25', label: '0.25 Kelly' },
  { value: 'kelly-0.50', label: '0.50 Kelly (maximum allowed)' },
  { value: 'conservative', label: 'Conservative blend (Kelly x confidence x liquidity)' },
]

/** Automated betting risk/staking rules. Never allow full (1.0) Kelly - 0.50 is the app's hard ceiling. */
export function RiskSettingsPanel(props: RiskSettingsPanelProps) {
  const router = useRouter()
  const [form, setForm] = useState(props)
  const [status, setStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<string>()

  function set<K extends keyof RiskSettingsPanelProps>(key: K, value: RiskSettingsPanelProps[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function save() {
    setStatus('pending')
    try {
      const response = await fetch('/api/betfair/risk-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await response.json()) as { success: boolean; message?: string }
      if (!response.ok || !payload.success) {
        setStatus('error')
        setMessage(payload.message ?? 'Failed to save')
        return
      }
      setStatus('saved')
      router.refresh()
    } catch {
      setStatus('error')
      setMessage('Could not reach the server')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Num label="Min confidence (0-1)" value={form.minConfidence} onChange={(v) => set('minConfidence', v)} />
        <Num label="Min edge (%)" value={form.minEdgePct} onChange={(v) => set('minEdgePct', v)} />
        <Num label="Min odds" value={form.minOdds} onChange={(v) => set('minOdds', v)} />
        <Num label="Max odds" value={form.maxOdds} onChange={(v) => set('maxOdds', v)} />
        <Num label="Min liquidity ($)" value={form.minLiquidity} onChange={(v) => set('minLiquidity', v)} />
        <Num label="Max bet ($)" value={form.maxBet} onChange={(v) => set('maxBet', v)} />
        <Num label="Max % of bankroll per bet" value={form.maxPctBankroll} onChange={(v) => set('maxPctBankroll', v)} />
        <Num label="Max total exposure (% bankroll)" value={form.maxTotalExposurePct} onChange={(v) => set('maxTotalExposurePct', v)} />
        <Num label="Max daily stake ($)" value={form.maxDailyStake} onChange={(v) => set('maxDailyStake', v)} />
        <Num label="Max daily loss (% bankroll)" value={form.maxDailyLossPct} onChange={(v) => set('maxDailyLossPct', v)} />
        <Num label="Max bets/day" value={form.maxBetsPerDay} onChange={(v) => set('maxBetsPerDay', v)} />
        <Num label="Max bets/race" value={form.maxBetsPerRace} onChange={(v) => set('maxBetsPerRace', v)} />
        <Num label="Min minutes to jump" value={form.minMinutesToJump} onChange={(v) => set('minMinutesToJump', v)} />
        <Num label="Max minutes to jump" value={form.maxMinutesToJump} onChange={(v) => set('maxMinutesToJump', v)} />
        <Num label="Flat stake ($)" value={form.flatStakeAmount} onChange={(v) => set('flatStakeAmount', v)} />
        <Num label="% of bankroll (pct-bankroll method)" value={form.pctBankrollStake} onChange={(v) => set('pctBankrollStake', v)} />
      </div>

      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Staking method
        <select value={form.stakingMethod} onChange={(e) => set('stakingMethod', e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
          {STAKING_METHODS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-4 text-xs text-slate-700">
        <label className="flex items-center gap-1"><input type="checkbox" checked={form.horseEnabled} onChange={(e) => set('horseEnabled', e.target.checked)} /> Horse racing</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={form.greyhoundEnabled} onChange={(e) => set('greyhoundEnabled', e.target.checked)} /> Greyhounds</label>
        <label className="flex items-center gap-1 text-red-700">
          <input type="checkbox" checked={form.nswThoroughbredAutoEnabled} onChange={(e) => set('nswThoroughbredAutoEnabled', e.target.checked)} />
          Allow automated NSW thoroughbred betting (default off - turnover-charge precaution)
        </label>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={status === 'pending'}
        className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {status === 'pending' ? 'Saving…' : 'Save Risk Settings'}
      </button>
      {status === 'error' && <p className="text-xs text-red-700">{message}</p>}
    </div>
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
