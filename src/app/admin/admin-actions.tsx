'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const actions = [
  { id: 'scrape-races', path: '/api/admin/scrape', label: 'Scrape Upcoming Races', detail: 'Import upcoming races from public sources' },
  { id: 'scrape-results', path: '/api/admin/scrape-results', label: 'Scrape Race Results', detail: 'Import results for completed races' },
  { id: 'predict-contextual', path: '/api/admin/predict', label: 'Run Prediction Model', detail: 'Generate predictions for upcoming races', mode: undefined },
  { id: 'predict-consensus', path: '/api/admin/predict', label: 'Run Consensus Model', detail: 'Generate predictions with cross-model consensus', mode: 'consensus' },
  { id: 'backtest', path: '/api/admin/backtest', label: 'Run Backtest', detail: 'Score predictions against actual results' },
]

export function AdminActions() {
  const router = useRouter()
  const [pendingActionId, setPendingActionId] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [isError, setIsError] = useState(false)

  async function runAction(actionId: string, path: string, mode?: string) {
    setPendingActionId(actionId)
    setMessage(undefined)

    try {
      const body: Record<string, unknown> = { raceId: '' }
      if (mode) body.mode = mode

      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json() as { message?: string }
      setIsError(!response.ok)
      setMessage(payload.message ?? (response.ok ? 'Action completed' : 'Action failed'))
      if (response.ok) router.refresh()
    } catch {
      setIsError(true)
      setMessage('Could not reach the server')
    } finally {
      setPendingActionId(undefined)
    }
  }

  return (
    <div className="space-y-3">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={Boolean(pendingActionId)}
          onClick={() => runAction(action.id, action.path, action.mode)}
          className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition disabled:cursor-wait disabled:opacity-60"
        >
          <span className="block font-medium text-slate-900">
            {pendingActionId === action.id ? 'Working…' : action.label}
          </span>
          <span className="block text-xs text-slate-500 mt-1">{action.detail}</span>
        </button>
      ))}
      {message && (
        <p
          role="status"
          className={`rounded-lg px-4 py-3 text-sm ${isError ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}
        >
          {message}
        </p>
      )}
    </div>
  )
}