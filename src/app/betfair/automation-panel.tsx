'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface AutomationPanelProps {
  mode: 'SIMULATION' | 'LIVE_MANUAL' | 'LIVE_AUTO'
  liveBettingEnabled: boolean
  allocatedBankroll: number
  maxBet: number
  maxDailyStake: number
  maxDailyLossPct: number
  stakingMethod: string
  minEdgePct: number
  minConfidence: number
}

/** LIVE AUTOMATED BETTING master switch. Default OFF. Turning it on requires explicit confirmation. Stage 1 always fail-closes this - see route comment. */
export function AutomationPanel(props: AutomationPanelProps) {
  const router = useRouter()
  const [showConfirm, setShowConfirm] = useState(false)
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle')
  const [message, setMessage] = useState<string>()

  async function setLiveBetting(enabled: boolean) {
    setStatus('pending')
    setMessage(undefined)
    try {
      const response = await fetch('/api/betfair/automation-state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ liveBettingEnabled: enabled }),
      })
      const payload = (await response.json()) as { success: boolean; message?: string }
      setStatus('idle')
      if (!response.ok || !payload.success) {
        setMessage(payload.message ?? 'Failed')
        return
      }
      setShowConfirm(false)
      router.refresh()
    } catch {
      setStatus('error')
      setMessage('Could not reach the server')
    }
  }

  async function emergencyStop() {
    setStatus('pending')
    try {
      await fetch('/api/betfair/automation-state', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emergencyStop: true, reason: 'Manual emergency stop from dashboard' }),
      })
      router.refresh()
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">LIVE AUTOMATED BETTING</p>
          <p className={`text-xs font-medium ${props.liveBettingEnabled ? 'text-red-700' : 'text-emerald-700'}`}>
            {props.liveBettingEnabled ? 'ON - real orders can be submitted' : 'OFF (default)'}
          </p>
        </div>
        {!props.liveBettingEnabled ? (
          <button type="button" onClick={() => setShowConfirm(true)} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">
            Turn ON
          </button>
        ) : (
          <button type="button" onClick={() => setLiveBetting(false)} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">
            Turn OFF
          </button>
        )}
      </div>

      <button type="button" onClick={emergencyStop} disabled={status === 'pending'} className="w-full rounded border-2 border-red-600 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
        STOP LIVE BETTING (emergency stop)
      </button>
      <p className="text-[11px] text-slate-500">Emergency stop disables automation immediately and forces Simulation mode. Existing matched bets are unaffected - it does not cancel them.</p>
      {message && <p className="text-xs text-red-700">{message}</p>}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-sm font-bold text-red-700">Confirm: Enable Live Automated Betting</h3>
            <dl className="mt-3 space-y-1 text-xs text-slate-700">
              <Row label="Allocated bankroll" value={`$${props.allocatedBankroll.toFixed(2)}`} />
              <Row label="Max bet" value={`$${props.maxBet.toFixed(2)}`} />
              <Row label="Max daily stake" value={`$${props.maxDailyStake.toFixed(2)}`} />
              <Row label="Max daily loss" value={`${(props.maxDailyLossPct * 100).toFixed(1)}% of bankroll`} />
              <Row label="Staking method" value={props.stakingMethod} />
              <Row label="Min edge" value={`${props.minEdgePct}%`} />
              <Row label="Min confidence" value={`${(props.minConfidence * 100).toFixed(0)}%`} />
              <Row label="Betfair connection" value="Not configured (Stage 1 - no credentials yet)" />
            </dl>
            <p className="mt-3 text-xs text-red-700">
              This app cannot actually enable live betting yet - Betfair API credentials are not configured. This confirms the request will be rejected by the server as a safety demonstration.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowConfirm(false)} className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={() => setLiveBetting(true)} disabled={status === 'pending'} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                Confirm - Enable Live Betting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  )
}
