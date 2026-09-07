'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recommendedStake, type StakingMethod } from '@/lib/betting/kelly'

export interface HorseBetActionsProps {
  raceId: string
  raceDatetime: string
  venue?: string
  raceNumber: number
  state?: string
  horseId: string
  horseName: string
  winOdds?: number
  winProbability: number
  confidence: number
  modelVersion: string
}

type Status = 'idle' | 'pending' | 'placed' | 'error'

export function HorseBetActions(props: HorseBetActionsProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [stake, setStake] = useState(10)
  const [suggesting, setSuggesting] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>()

  if (!props.winOdds) return null

  const winOdds = props.winOdds

  async function openPaperForm() {
    setOpen(true)
    setStatus('idle')
    setMessage(undefined)
    setSuggesting(true)
    try {
      const response = await fetch('/api/paper-betting/account')
      const payload = (await response.json()) as { success: boolean; exists?: boolean; account?: { staking_method: string; current_bankroll: number } }
      if (payload.success && payload.exists && payload.account) {
        const suggested = recommendedStake(payload.account.staking_method as StakingMethod, payload.account.current_bankroll, winOdds, props.winProbability)
        setStake(suggested > 0 ? suggested : 10)
      }
    } catch {
      // Keep the default stake if the suggestion lookup fails - the field remains editable either way.
    } finally {
      setSuggesting(false)
    }
  }

  async function confirmPaper() {
    setStatus('pending')
    try {
      const response = await fetch('/api/paper-betting/bets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raceId: props.raceId,
          runnerId: props.horseId,
          runnerName: props.horseName,
          category: 'horse',
          source: 'internal',
          betType: 'WIN',
          tabDecimalOdds: winOdds,
          modelProbability: props.winProbability,
          modelVersion: props.modelVersion,
          stakeOverride: stake,
        }),
      })
      const payload = (await response.json()) as { success: boolean; message?: string }
      if (!response.ok || !payload.success) {
        setStatus('error')
        setMessage(payload.message ?? 'Failed to place paper bet')
        return
      }
      setStatus('placed')
      setMessage(`Paper bet placed: $${stake.toFixed(2)} @ $${winOdds.toFixed(2)}`)
      router.refresh()
    } catch {
      setStatus('error')
      setMessage('Could not reach the server')
    }
  }

  if (status === 'placed') {
    return <span className="text-xs font-medium text-emerald-700">{message}</span>
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button type="button" onClick={openPaperForm} className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700">
          Paper Bet
        </button>
      </div>

      {open && (
        <div className="mt-1 flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
          <label className="flex items-center gap-1 text-xs text-slate-600">
            $
            <input
              type="number"
              min={1}
              step={1}
              value={stake}
              onChange={(e) => setStake(Number(e.target.value))}
              disabled={suggesting || status === 'pending'}
              className="w-16 rounded border border-slate-300 px-1 py-0.5 text-xs"
            />
          </label>
          <button
            type="button"
            onClick={confirmPaper}
            disabled={suggesting || status === 'pending'}
            className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {suggesting ? 'Suggesting…' : status === 'pending' ? 'Placing…' : 'Confirm'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700">
            Cancel
          </button>
        </div>
      )}
      {status === 'error' && <span className="text-xs text-red-700">{message}</span>}
    </div>
  )
}
