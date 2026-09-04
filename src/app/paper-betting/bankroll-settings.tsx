'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface BankrollSettingsProps {
  currentStartingBankroll: number | null
  currentStakingMethod?: string
  betCount: number
}

const STAKING_METHODS = [
  { value: 'flat-1pct', label: 'Flat 1% of bankroll' },
  { value: 'flat-2pct', label: 'Flat 2% of bankroll' },
  { value: 'kelly-0.10', label: '0.10 Kelly' },
  { value: 'kelly-0.25', label: '0.25 Kelly' },
]

/** Lets the user pick/change their paper-betting starting budget. Existing profit/loss is preserved
 * unless they explicitly tick "wipe bet history", which is destructive and requires confirmation. */
export function BankrollSettings({ currentStartingBankroll, currentStakingMethod, betCount }: BankrollSettingsProps) {
  const router = useRouter()
  const [amount, setAmount] = useState(currentStartingBankroll ?? 500)
  const [stakingMethod, setStakingMethod] = useState(currentStakingMethod ?? 'flat-1pct')
  const [wipeHistory, setWipeHistory] = useState(false)
  const [status, setStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState<string>()
  const [regenerateStatus, setRegenerateStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle')
  const [regenerateMessage, setRegenerateMessage] = useState<string>()

  async function save() {
    if (wipeHistory && betCount > 0) {
      const confirmed = window.confirm(
        `This will permanently delete all ${betCount} recorded paper bets and reset your bankroll to $${amount.toFixed(2)}. This cannot be undone. Continue?`
      )
      if (!confirmed) return
    }

    setStatus('pending')
    setMessage(undefined)
    try {
      const response = await fetch('/api/paper-betting/account', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startingBankroll: amount, stakingMethod, reset: wipeHistory }),
      })
      const payload = (await response.json()) as { success: boolean; message?: string }
      if (!response.ok || !payload.success) {
        setStatus('error')
        setMessage(payload.message ?? 'Failed to save')
        return
      }
      setStatus('saved')
      setMessage(payload.message)
      setWipeHistory(false)
      router.refresh()
    } catch {
      setStatus('error')
      setMessage('Could not reach the server')
    }
  }

  async function regenerate() {
    const confirmed = window.confirm(
      'This clears all pending (not-yet-settled) auto-placed bets and re-runs the PuntersEdge sync so they get recreated with your updated budget/staking method. Already-settled bets are untouched. Continue?'
    )
    if (!confirmed) return

    setRegenerateStatus('pending')
    setRegenerateMessage(undefined)
    try {
      const response = await fetch('/api/paper-betting/regenerate', { method: 'POST' })
      const payload = (await response.json()) as { success: boolean; message?: string }
      if (!response.ok || !payload.success) {
        setRegenerateStatus('error')
        setRegenerateMessage(payload.message ?? 'Failed to regenerate')
        return
      }
      setRegenerateStatus('done')
      setRegenerateMessage(payload.message)
      router.refresh()
    } catch {
      setRegenerateStatus('error')
      setRegenerateMessage('Could not reach the server')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Starting budget
          <span className="flex items-center gap-1">
            $
            <input
              type="number"
              min={1}
              step={10}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
              disabled={status === 'pending'}
            />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Staking method
          <select
            value={stakingMethod}
            onChange={(e) => setStakingMethod(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            disabled={status === 'pending'}
          >
            {STAKING_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={save}
          disabled={status === 'pending' || !amount || amount <= 0}
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {status === 'pending' ? 'Saving…' : currentStartingBankroll == null ? 'Create Account' : 'Save'}
        </button>
      </div>

      {betCount > 0 && (
        <label className="mt-3 flex items-center gap-2 text-xs text-red-700">
          <input type="checkbox" checked={wipeHistory} onChange={(e) => setWipeHistory(e.target.checked)} disabled={status === 'pending'} />
          Wipe all {betCount} recorded bets and reset bankroll instead of preserving current profit/loss (cannot be undone)
        </label>
      )}
      {currentStartingBankroll != null && !wipeHistory && (
        <p className="mt-2 text-[11px] text-slate-500">Changing this preserves your current net profit/loss - only the starting reference point moves.</p>
      )}

      {status === 'saved' && <p className="mt-2 text-xs text-emerald-700">{message}</p>}
      {status === 'error' && <p className="mt-2 text-xs text-red-700">{message}</p>}

      {currentStartingBankroll != null && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={regenerate}
            disabled={regenerateStatus === 'pending'}
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {regenerateStatus === 'pending' ? 'Regenerating…' : 'Regenerate Recent Bets'}
          </button>
          <p className="mt-1 text-[11px] text-slate-500">
            Run this after changing your budget or staking method above - it clears pending auto-placed bets and re-syncs them at the new stake size.
          </p>
          {regenerateStatus === 'done' && <p className="mt-2 text-xs text-emerald-700">{regenerateMessage}</p>}
          {regenerateStatus === 'error' && <p className="mt-2 text-xs text-red-700">{regenerateMessage}</p>}
        </div>
      )}
    </div>
  )
}

