export function SnapshotStatus({ generatedAt }: { generatedAt: string | undefined }) {
  if (!generatedAt) return <p role="status" className="my-3 text-sm text-amber-800">Page data temporarily unavailable. Waiting for a successful refresh.</p>
  return <p role="status" className="my-2 text-xs text-slate-500">
    Last successful refresh: {new Date(generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
  </p>
}