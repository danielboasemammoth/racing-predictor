'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RefreshRaceButton({ raceId }: { raceId: string }) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'refreshing' | 'error'>('idle')
  const [message, setMessage] = useState<string>()
  const [updatedAt, setUpdatedAt] = useState<string>()

  async function refresh() {
    setStatus('refreshing')
    setMessage(undefined)
    try {
      const response = await fetch('/api/admin/refresh-race', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raceId }),
      })
      const payload = await response.json() as { success: boolean; message?: string; updatedAt?: string }
      if (!response.ok || !payload.success) {
        setStatus('error')
        setMessage(payload.message ?? 'Refresh failed')
        return
      }
      setStatus('idle')
      setUpdatedAt(payload.updatedAt)
      router.refresh()
    } catch {
      setStatus('error')
      setMessage('Could not reach the server')
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={status === 'refreshing'}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
      >
        {status === 'refreshing' ? 'Refreshing…' : 'Refresh Race'}
      </button>
      {updatedAt && status === 'idle' && (
        <p className="text-xs text-slate-500">Updated: {new Date(updatedAt).toLocaleTimeString('en-AU')}</p>
      )}
      {status === 'error' && message && <p className="text-xs text-red-700">{message}</p>}
    </div>
  )
}
