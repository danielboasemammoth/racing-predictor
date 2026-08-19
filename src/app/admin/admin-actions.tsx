'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ActionStep {
  path: string
  mode?: string
  label: string
}

interface AdminAction {
  id: string
  label: string
  detail: string
  steps: ActionStep[]
}

const actions: AdminAction[] = [
  {
    id: 'scrape-races',
    label: 'Sync Upcoming Races',
    detail: 'Import upcoming Victorian race fields from Racing.com',
    steps: [{ path: '/api/admin/scrape', label: 'Importing upcoming races' }],
  },
  {
    id: 'sync-results',
    label: 'Sync Results & Backfill Predictions',
    detail: 'Import finished race results, then regenerate predictions for every completed race so Backtest has fresh data to score',
    steps: [
      { path: '/api/admin/scrape-results', label: 'Importing race results' },
      { path: '/api/admin/predict', mode: 'retrospective', label: 'Backfilling predictions for completed races' },
    ],
  },
  {
    id: 'predict-upcoming',
    label: 'Generate Predictions',
    detail: 'Run every model variant plus the ensemble for upcoming races',
    steps: [{ path: '/api/admin/predict', mode: 'all', label: 'Generating predictions' }],
  },
  {
    id: 'backtest',
    label: 'Run Backtest',
    detail: 'Score stored predictions against actual results for every completed race',
    steps: [{ path: '/api/admin/backtest', label: 'Scoring predictions' }],
  },
]

export function AdminActions() {
  const router = useRouter()
  const [pendingActionId, setPendingActionId] = useState<string>()
  const [stepLabel, setStepLabel] = useState<string>()
  const [stepProgress, setStepProgress] = useState<{ index: number; total: number }>()
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [message, setMessage] = useState<string>()
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    if (!pendingActionId) return

    const start = Date.now()
    const interval = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(interval)
  }, [pendingActionId])

  async function runAction(action: AdminAction) {
    setPendingActionId(action.id)
    setMessage(undefined)
    setElapsedSeconds(0)

    try {
      let lastPayload: { message?: string } = {}
      for (const [index, step] of action.steps.entries()) {
        setStepLabel(step.label)
        setStepProgress(action.steps.length > 1 ? { index: index + 1, total: action.steps.length } : undefined)

        const body: Record<string, unknown> = {}
        if (step.mode) body.mode = step.mode

        const response = await fetch(step.path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = await response.json() as { message?: string }
        if (!response.ok) {
          setIsError(true)
          setMessage(`${step.label} failed: ${payload.message ?? 'Action failed'}`)
          return
        }
        lastPayload = payload
      }
      setIsError(false)
      setMessage(lastPayload.message ?? 'Action completed')
      router.refresh()
    } catch {
      setIsError(true)
      setMessage('Could not reach the server')
    } finally {
      setPendingActionId(undefined)
      setStepLabel(undefined)
      setStepProgress(undefined)
    }
  }

  return (
    <div className="space-y-3">
      {actions.map((action) => {
        const isPending = pendingActionId === action.id
        return (
          <button
            key={action.id}
            type="button"
            disabled={Boolean(pendingActionId)}
            onClick={() => runAction(action)}
            className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition disabled:cursor-wait disabled:opacity-60"
          >
            <span className="block font-medium text-slate-900">
              {isPending
                ? `${stepLabel}${stepProgress ? ` (step ${stepProgress.index}/${stepProgress.total})` : ''} · ${elapsedSeconds}s elapsed`
                : action.label}
            </span>
            <span className="block text-xs text-slate-500 mt-1">{action.detail}</span>
          </button>
        )
      })}
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