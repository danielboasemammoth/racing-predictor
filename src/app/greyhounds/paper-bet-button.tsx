'use client'

import { useState } from 'react'

export interface PaperBetButtonProps {
  raceId: string
  runnerId: string
  runnerName: string
  category: 'horse' | 'greyhound' | 'harness'
  tabWinPrice: number
  modelProbability: number
  modelVersion: string
  edgePoints: number | null
  expectedValue: number | null
  confidenceLevel: string | null
}

/** MANUAL PAPER BETTING: places a simulated bet at the TAB price shown right now. No real money moves. */
export function PaperBetButton(props: PaperBetButtonProps) {
  const [stake, setStake] = useState(10)
  const [status, setStatus] = useState<'idle' | 'pending' | 'placed' | 'error'>('idle')
  const [message, setMessage] = useState<string>()

  async function placeBet() {
    setStatus('pending')
    setMessage(undefined)
    try {
      const response = await fetch('/api/paper-betting/bets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          raceId: props.raceId,
          runnerId: props.runnerId,
          runnerName: props.runnerName,
          category: props.category,
          tabDecimalOdds: props.tabWinPrice,
          modelProbability: props.modelProbability,
          modelVersion: props.modelVersion,
          edgePoints: props.edgePoints,
          expectedValue: props.expectedValue,
          confidenceLevel: props.confidenceLevel,
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
      setMessage(`Paper bet placed: $${stake.toFixed(2)} @ $${props.tabWinPrice.toFixed(2)}`)
    } catch {
      setStatus('error')
      setMessage('Could not reach the server')
    }
  }

  if (status === 'placed') {
    return <span className="text-xs font-medium text-emerald-700">{message}</span>
  }

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-slate-600">
        $
        <input
          type="number"
          min={1}
          step={1}
          value={stake}
          onChange={(e) => setStake(Number(e.target.value))}
          className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs"
          disabled={status === 'pending'}
        />
      </label>
      <button
        type="button"
        onClick={placeBet}
        disabled={status === 'pending'}
        className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {status === 'pending' ? 'Placing…' : 'PAPER BET'}
      </button>
      {status === 'error' && <span className="text-xs text-red-700">{message}</span>}
    </div>
  )
}
