'use client'

import { useState } from 'react'

export interface PaperBetButtonProps {
  raceId: string
  runnerId: string
  runnerName: string
  category: 'horse' | 'greyhound' | 'harness'
  tabWinPrice: number
  tabPlacePrice: number | null
  modelProbability: number
  modelVersion: string
  edgePoints: number | null
  expectedValue: number | null
  confidenceLevel: string | null
  /** Harville-derived place probability/edge - used instead of the win figures when betType is PLACE. */
  placeModelProbability: number | null
  placeEdgePoints: number | null
  placeExpectedValue: number | null
}

/** MANUAL PAPER BETTING: places a simulated bet at the TAB price shown right now. No real money moves. */
export function PaperBetButton(props: PaperBetButtonProps) {
  const [stake, setStake] = useState(10)
  const [betType, setBetType] = useState<'WIN' | 'PLACE'>('WIN')
  const [status, setStatus] = useState<'idle' | 'pending' | 'placed' | 'error'>('idle')
  const [message, setMessage] = useState<string>()

  const price = betType === 'PLACE' ? props.tabPlacePrice : props.tabWinPrice
  const modelProbability = betType === 'PLACE' ? props.placeModelProbability : props.modelProbability
  const edgePoints = betType === 'PLACE' ? props.placeEdgePoints : props.edgePoints
  const expectedValue = betType === 'PLACE' ? props.placeExpectedValue : props.expectedValue

  async function placeBet() {
    if (!price || modelProbability == null) return
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
          betType,
          tabDecimalOdds: price,
          modelProbability,
          modelVersion: props.modelVersion,
          edgePoints,
          expectedValue,
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
      setMessage(`Paper bet placed: $${stake.toFixed(2)} ${betType} @ $${price.toFixed(2)}`)
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
      <select
        value={betType}
        onChange={(e) => setBetType(e.target.value as 'WIN' | 'PLACE')}
        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
        disabled={status === 'pending'}
      >
        <option value="WIN">WIN</option>
        <option value="PLACE" disabled={!props.tabPlacePrice || props.placeModelProbability == null}>PLACE</option>
      </select>
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
        disabled={status === 'pending' || !price || modelProbability == null}
        className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {status === 'pending' ? 'Placing…' : 'PAPER BET'}
      </button>
      {status === 'error' && <span className="text-xs text-red-700">{message}</span>}
    </div>
  )
}
