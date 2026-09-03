'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recommendedStake, type StakingMethod } from '@/lib/betting/kelly'
import { computeStake, type BetfairStakingMethod } from '@/lib/betfair/staking'

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

type FormKind = 'paper' | 'betfair' | null
type Status = 'idle' | 'pending' | 'placed' | 'error'

/** Betfair Stage 1: no real market feed yet, so the "Betfair Bet" button places a SIMULATED bet using Racing.com's recorded price as a stand-in. */
const ASSUMED_LIQUIDITY = 200
const ASSUMED_MARKET_BASE_RATE = 0.08

export function HorseBetActions(props: HorseBetActionsProps) {
  const router = useRouter()
  const [openForm, setOpenForm] = useState<FormKind>(null)
  const [stake, setStake] = useState(10)
  const [suggesting, setSuggesting] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>()

  if (!props.winOdds) return null

  const winOdds = props.winOdds

  async function openPaperForm() {
    setOpenForm('paper')
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

  async function openBetfairForm() {
    setOpenForm('betfair')
    setStatus('idle')
    setMessage(undefined)
    setSuggesting(true)
    try {
      const [bankrollRes, riskRes] = await Promise.all([fetch('/api/betfair/bankroll'), fetch('/api/betfair/risk-settings')])
      const bankrollPayload = (await bankrollRes.json()) as { success: boolean; config?: { simulated_current_bankroll: number; allocated_bankroll: number } }
      const riskPayload = (await riskRes.json()) as {
        success: boolean
        settings?: { staking_method: string; flat_stake_amount: number; pct_bankroll_stake: number; max_bet: number; max_pct_bankroll: number }
      }
      if (bankrollPayload.success && bankrollPayload.config && riskPayload.success && riskPayload.settings) {
        const s = riskPayload.settings
        const bankroll = Math.min(bankrollPayload.config.simulated_current_bankroll, bankrollPayload.config.allocated_bankroll)
        const suggested = computeStake({
          method: s.staking_method as BetfairStakingMethod,
          bankroll,
          decimalOdds: winOdds,
          modelProbability: props.winProbability,
          flatStakeAmount: s.flat_stake_amount,
          pctBankrollStake: s.pct_bankroll_stake,
          limits: { maxBet: s.max_bet, maxPctBankroll: s.max_pct_bankroll },
          confidence: props.confidence,
          modelUncertainty: 1 - props.confidence,
          liquidityAvailable: ASSUMED_LIQUIDITY,
        })
        setStake(suggested > 0 ? suggested : s.flat_stake_amount)
      }
    } catch {
      // Keep the default stake if the suggestion lookup fails.
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

  async function confirmBetfair() {
    setStatus('pending')
    try {
      const minutesToJump = Math.round((new Date(props.raceDatetime).getTime() - Date.now()) / 60_000)
      const response = await fetch('/api/betfair/bets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          marketId: `internal:${props.raceId}`,
          selectionId: props.horseId,
          runnerName: props.horseName,
          racingCode: 'horse',
          venue: props.venue ?? null,
          raceNumber: props.raceNumber,
          state: props.state ?? null,
          jumpTime: props.raceDatetime,
          currentBestPrice: winOdds,
          availableLiquidity: ASSUMED_LIQUIDITY,
          minutesToJump,
          modelProbability: props.winProbability,
          confidence: props.confidence,
          modelVersion: props.modelVersion,
          marketBaseRate: ASSUMED_MARKET_BASE_RATE,
          stakeOverride: stake,
        }),
      })
      const payload = (await response.json()) as { success: boolean; decision?: string; reasons?: string[]; message?: string; stake?: number }
      if (!response.ok || !payload.success) {
        setStatus('error')
        setMessage(payload.message ?? 'Failed to place Betfair bet')
        return
      }
      if (payload.decision === 'NO_BET') {
        setStatus('error')
        setMessage(`NO BET: ${(payload.reasons ?? []).join('; ')}`)
        return
      }
      setStatus('placed')
      setMessage(`Simulated Betfair bet placed: $${(payload.stake ?? stake).toFixed(2)} @ $${winOdds.toFixed(2)}`)
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
        <button type="button" onClick={openBetfairForm} className="rounded bg-teal-700 px-2 py-1 text-xs font-medium text-white hover:bg-teal-800">
          Betfair Bet
        </button>
      </div>

      {openForm && (
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
            onClick={openForm === 'paper' ? confirmPaper : confirmBetfair}
            disabled={suggesting || status === 'pending'}
            className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {suggesting ? 'Suggesting…' : status === 'pending' ? 'Placing…' : 'Confirm'}
          </button>
          <button type="button" onClick={() => setOpenForm(null)} className="text-xs text-slate-500 hover:text-slate-700">
            Cancel
          </button>
        </div>
      )}
      {openForm === 'betfair' && (
        <p className="text-[10px] text-slate-400">Simulated - no live Betfair feed yet, using Racing.com&apos;s recorded price as a stand-in.</p>
      )}
      {status === 'error' && <span className="text-xs text-red-700">{message}</span>}
    </div>
  )
}
