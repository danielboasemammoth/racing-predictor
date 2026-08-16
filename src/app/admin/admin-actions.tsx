'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const actions = [
  { path: '/api/admin/scrape', label: 'Scrape Upcoming Races', detail: 'Import upcoming races from public sources' },
  { path: '/api/admin/scrape-results', label: 'Scrape Race Results', detail: 'Import results for completed races' },
  { path: '/api/admin/predict', label: 'Run Prediction Model', detail: 'Generate predictions for upcoming races', mode: undefined },
  { path: '/api/admin/predict', label: 'Run Consensus Model', detail: 'Generate predictions with cross-model consensus', mode: 'consensus' },
  { path: '/api/admin/backtest', label: 'Run Backtest', detail: 'Score predictions against actual results' },
  { path: '/api/admin/import-csv', label: 'Import Race CSV', detail: 'Upload Victoria race results as CSV' },
]

export function AdminActions() {
  const router = useRouter()
  const [pendingPath, setPendingPath] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [isError, setIsError] = useState(false)

  async function runAction(path: string, mode?: string) {
    setPendingPath(path)
    setMessage(undefined)

    try {
      let body: Record<string, unknown> = { raceId: '' }
      if (mode) body.mode = mode

      if (path === '/api/admin/import-csv') {
        const csv = typeof window !== 'undefined' ? window.prompt('Paste Victoria race CSV here:') : ''
        if (!csv) {
          setMessage('CSV import cancelled')
          setPendingPath(undefined)
          return
        }
        body = { csv }
      }

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
      setPendingPath(undefined)
    }
  }

  return (
    <div className="space-y-3">
      {actions.map((action) => (
        <button
          key={action.path}
          type="button"
          disabled={Boolean(pendingPath)}
          onClick={() => runAction(action.path, action.mode)}
          className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition disabled:cursor-wait disabled:opacity-60"
        >
          <span className="block font-medium text-slate-900">
            {pendingPath === action.path ? 'Working…' : action.label}
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