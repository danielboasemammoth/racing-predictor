'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const serverTimeZone = () => 'UTC'

export function SnapshotStatus({ generatedAt }: { generatedAt: string | undefined }) {
  const timeZone = useSyncExternalStore(subscribe, browserTimeZone, serverTimeZone)
  if (!generatedAt) return <p role="status" className="my-3 text-sm text-amber-800">Page data temporarily unavailable. Waiting for a successful refresh.</p>
  return <p role="status" className="my-2 text-xs text-slate-500">
    Last successful refresh: <time dateTime={generatedAt}>{new Date(generatedAt).toLocaleString('en-AU', { timeZone, timeZoneName: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
  </p>
}