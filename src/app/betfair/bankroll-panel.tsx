'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface BankrollPanelProps {
  actualBetfairBalance: number | null
  allocatedBankroll: number
  reserveBalance: number
  bankrollCeiling: number | null
  withdrawalThreshold: number | null
  topupThreshold: number | null
  simulatedStartingBankroll: number
  simulatedCurrentBankroll: number
}

/** Bankroll allocation is NOT a deposit/withdrawal mechanism - purely an application risk boundary. */
export function BankrollPanel(props: BankrollPanelProps) {
  const router = useRouter()
  const [allocated, setAllocated] = useState(props.allocatedBankroll)
  const [reserve, setReserve] = useState(props.reserveBalance)
  const [ceiling, setCeiling] = useState(props.bankrollCeiling ?? 0)
  const [withdrawalThreshold, setWithdrawalThreshold] = useState(props.withdrawalThreshold ?? 0)
  const [topupThreshold, setTopupThreshold] = useState(props.topupThreshold ?? 0)
  const [simulatedStarting, setSimulatedStarting] = useState(props.simulatedStartingBankroll)
  const [status, setStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<string>()

  async function save() {
    setStatus('pending')
    try {
      const response = await fetch('/api/betfair/bankroll', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          allocatedBankroll: allocated,
          reserveBalance: reserve,
          bankrollCeiling: ceiling || null,
          withdrawalThreshold: withdrawalThreshold || null,
          topupThreshold: topupThreshold || null,
          simulatedStartingBankroll: simulatedStarting,
        }),
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

  const suggestWithdrawal = withdrawalThreshold > 0 && props.simulatedCurrentBankroll >= withdrawalThreshold
  const belowConfigured = topupThreshold > 0 && props.simulatedCurrentBankroll < topupThreshold

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Allocated bankroll ($)" value={allocated} onChange={setAllocated} />
        <Field label="Reserve - never used by automation ($)" value={reserve} onChange={setReserve} />
        <Field label="Bankroll ceiling ($, 0 = none)" value={ceiling} onChange={setCeiling} />
        <Field label="Withdrawal-suggested threshold ($, 0 = off)" value={withdrawalThreshold} onChange={setWithdrawalThreshold} />
        <Field label="Top-up-suggested threshold ($, 0 = off)" value={topupThreshold} onChange={setTopupThreshold} />
        <Field label="Simulated starting bankroll ($)" value={simulatedStarting} onChange={setSimulatedStarting} />
      </div>
      <p className="text-[11px] text-slate-500">
        This is a risk boundary the app enforces - it is NOT a deposit. Real Betfair deposits/withdrawals remain manual, through Betfair directly.
      </p>
      {suggestWithdrawal && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Profit withdrawal suggested (bankroll at or above your configured threshold).</p>}
      {belowConfigured && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">Bankroll below configured level.</p>}
      <button
        type="button"
        onClick={save}
        disabled={status === 'pending'}
        className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {status === 'pending' ? 'Saving…' : 'Save Bankroll Settings'}
      </button>
      {status === 'error' && <p className="text-xs text-red-700">{message}</p>}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input type="number" step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1 text-sm" />
    </label>
  )
}
