'use client'

import { useState } from 'react'

interface WhatIfStats {
  numberOfBets: number
  numberSettled: number
  winRate: number | null
  roiPct: number
  netProfit: number
  maxDrawdownPct: number
  currentBankroll: number
}

interface WhatIfResponse {
  success: boolean
  exists?: boolean
  totalHistoricalBets?: number
  stats?: WhatIfStats
  message?: string
}

const CONFIDENCE_LEVELS = ['VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']
const STAKING_METHODS = [
  { value: '', label: 'Keep original stakes' },
  { value: 'flat-1pct', label: 'Flat 1%' },
  { value: 'flat-2pct', label: 'Flat 2%' },
  { value: 'kelly-0.10', label: '0.10 Kelly' },
  { value: 'kelly-0.25', label: '0.25 Kelly' },
]
const CATEGORIES = ['horse', 'greyhound', 'harness']

/** SIMULATION LABORATORY: recomputes historical paper-bet performance under different rules without touching the original records. */
export function WhatIfLab() {
  const [minConfidenceLevel, setMinConfidenceLevel] = useState('')
  const [minEdgePoints, setMinEdgePoints] = useState('')
  const [minOdds, setMinOdds] = useState('')
  const [maxOdds, setMaxOdds] = useState('')
  const [stakingMethod, setStakingMethod] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [result, setResult] = useState<WhatIfResponse>()
  const [loading, setLoading] = useState(false)

  function toggleCategory(category: string) {
    setCategories((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]))
  }

  async function run() {
    setLoading(true)
    const params = new URLSearchParams()
    if (minConfidenceLevel) params.set('minConfidenceLevel', minConfidenceLevel)
    if (minEdgePoints) params.set('minEdgePoints', minEdgePoints)
    if (minOdds) params.set('minOdds', minOdds)
    if (maxOdds) params.set('maxOdds', maxOdds)
    if (stakingMethod) params.set('stakingMethod', stakingMethod)
    if (categories.length > 0) params.set('categories', categories.join(','))

    try {
      const response = await fetch(`/api/paper-betting/what-if?${params.toString()}`)
      const payload = (await response.json()) as WhatIfResponse
      setResult(payload)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-600">
          Min confidence
          <select value={minConfidenceLevel} onChange={(e) => setMinConfidenceLevel(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm">
            <option value="">Any</option>
            {CONFIDENCE_LEVELS.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Min edge (pts)
          <input type="number" value={minEdgePoints} onChange={(e) => setMinEdgePoints(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Staking method
          <select value={stakingMethod} onChange={(e) => setStakingMethod(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm">
            {STAKING_METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Min odds
          <input type="number" step="0.1" value={minOdds} onChange={(e) => setMinOdds(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-slate-600">
          Max odds
          <input type="number" step="0.1" value={maxOdds} onChange={(e) => setMaxOdds(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm" />
        </label>
        <div className="text-xs text-slate-600">
          Racing code
          <div className="mt-1 flex gap-2">
            {CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-1">
                <input type="checkbox" checked={categories.includes(category)} onChange={() => toggleCategory(category)} />
                {category}
              </label>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="mt-4 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {loading ? 'Running…' : 'Run Simulation'}
      </button>

      {result?.success && result.exists === false && (
        <p className="mt-3 text-xs text-slate-500">No paper betting account yet.</p>
      )}
      {result?.success && result.stats && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ResultStat label="Qualifying Bets" value={String(result.stats.numberSettled)} />
          <ResultStat label="Strike Rate" value={result.stats.winRate != null ? `${(result.stats.winRate * 100).toFixed(1)}%` : 'n/a'} />
          <ResultStat label="ROI" value={`${result.stats.roiPct >= 0 ? '+' : ''}${result.stats.roiPct.toFixed(1)}%`} accent={result.stats.roiPct >= 0} />
          <ResultStat label="Net Profit" value={`${result.stats.netProfit >= 0 ? '+' : ''}$${result.stats.netProfit.toFixed(2)}`} accent={result.stats.netProfit >= 0} />
          <ResultStat label="Max Drawdown" value={`${result.stats.maxDrawdownPct.toFixed(1)}%`} />
          <ResultStat label="Total History" value={`${result.totalHistoricalBets} bets`} />
        </div>
      )}
      {result && !result.success && <p className="mt-3 text-xs text-red-700">{result.message}</p>}
    </div>
  )
}

function ResultStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded border border-slate-200 px-3 py-2">
      <p className="text-[10px] uppercase text-slate-500">{label}</p>
      <p className={`text-sm font-semibold ${accent === true ? 'text-emerald-700' : accent === false ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}
