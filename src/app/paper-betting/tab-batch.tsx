'use client'

import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import type { SimulationPreferences } from '@/lib/betting/simulation-preferences'
import type { TabBatchPreview, TabJurisdiction } from '@/lib/betting/tab-batch'

const money = (amount: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount)
const time = (value: string) => new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })

export function TabBatch({ preferences }: { preferences: SimulationPreferences }) {
  const [jurisdiction, setJurisdiction] = useState<TabJurisdiction | ''>('')
  const [preview, setPreview] = useState<TabBatchPreview | null>(null)
  const [generatedFor, setGeneratedFor] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(0)
  const signature = JSON.stringify({ preferences, jurisdiction })
  const valid = preview && generatedFor === signature && now < Date.parse(preview.expiresAt)
  const batchStatus = busy ? 'Generating batch...'
    : error ? 'Batch generation failed. See the error below.'
    : !jurisdiction ? 'No jurisdiction selected.'
    : !preview ? 'Ready. No batch generated yet.'
    : !valid ? 'Preview expired or configuration changed. Generate again.'
    : !preview.text ? 'No eligible bets. See the selection details below.'
    : copied ? 'Copied.' : 'Batch ready to copy.'
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  async function generate() {
    setBusy(true); setError(''); setPreview(null); setCopied(false)
    const requestedFor = signature
    try {
      const response = await fetch('/api/paper-betting/tab-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: signature, signal: AbortSignal.timeout(90_000) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message ?? 'Batch preview unavailable')
      setPreview(result); setGeneratedFor(requestedFor); setNow(Date.now())
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Batch preview unavailable') }
    finally { setBusy(false) }
  }

  async function copy() {
    if (!valid || !preview.text || Date.now() >= Date.parse(preview.expiresAt)) { setNow(Date.now()); return }
    try { await navigator.clipboard.writeText(preview.text); setCopied(true); setError('') }
    catch { setError('Clipboard access was denied. Select the generated text and copy it manually.') }
  }

  return <section aria-label="TAB Tote batch" className="border-y border-slate-200 py-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="font-semibold">Today&apos;s TAB Tote batch</h3><p className="mt-1 text-xs text-slate-600">Upcoming races today, Melbourne date. Current paper-betting configuration.</p></div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">TAB account jurisdiction<select aria-label="TAB account jurisdiction" value={jurisdiction} onChange={event => { setJurisdiction(event.target.value as TabJurisdiction); setCopied(false) }} className="mt-1 block h-9 rounded border border-slate-300 bg-white px-2 text-sm"><option value="">Select jurisdiction</option>{['VIC', 'NSW', 'QLD'].map(value => <option key={value}>{value}</option>)}</select></label>
        <button type="button" onClick={() => void generate()} disabled={busy || !jurisdiction} className="flex h-9 items-center gap-2 rounded border border-teal-700 bg-white px-3 text-sm text-teal-800 disabled:opacity-40"><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />{busy ? 'Generating...' : 'Generate batch'}</button>
        <button type="button" title="Copy TAB batch text" aria-label="Copy TAB batch text" onClick={() => void copy()} disabled={!valid || !preview?.text || busy} className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white disabled:opacity-40"><Copy size={16} /></button>
      </div>
    </div>
    <div className="mt-3">
      <label className="block text-xs font-medium text-slate-600" htmlFor="tab-batch-text">TAB batch text</label>
      <p id="tab-batch-status" role="status" className="mt-1 text-xs text-slate-600">{batchStatus}</p>
      <textarea id="tab-batch-text" aria-label="TAB batch text" aria-describedby="tab-batch-status" aria-busy={busy} readOnly spellCheck={false}
        value={valid && !busy ? preview.text : ''} placeholder={batchStatus} rows={6}
        className="mt-1 block w-full resize-y rounded border border-slate-300 bg-white p-3 font-mono text-sm text-slate-900" />
    </div>
    <p className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-xs text-amber-950">Tote only: dividends are unknown, and the simulator&apos;s fixed-odds profit/ROI does not apply. Flat stakes only; the configured starting bankroll is a batch ceiling, not your TAB balance. No bets are submitted here. Check meeting codes, runners, total cost and TAB&apos;s confirmation before placing any bets. Repeatedly submitting the same batch can place duplicate bets.</p>
    <p className="mt-2 text-xs text-slate-600"><a href="https://www.tab.com.au/info/batch-betting" target="_blank" rel="noreferrer" className="text-teal-800 underline">TAB format guide</a>{' / '}<a href="https://help.tab.com.au/betting-on-racing/batch-betting-through-tab" target="_blank" rel="noreferrer" className="text-teal-800 underline">Batch betting help</a>. Custom price-based filters use recorded fixed-odds references, not guaranteed Tote dividends. Exact History uses archived upcoming picks and flat stakes regardless of the historical settlement-odds setting.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {preview && <>
      <p role="status" className="mt-3 text-sm font-medium">{preview.rows.length} bet lines / {money(preview.total)} combined stake / {preview.jurisdiction}. Generated {time(preview.generatedAt)}.{!valid ? ' Preview expired or configuration changed. Generate again.' : copied ? ' Copied.' : ` Valid until ${time(preview.expiresAt)}.`}</p>
      {preview.warnings.map((warning, index) => <p key={index} className="mt-2 text-xs text-amber-900">{warning}</p>)}
      {preview.rows.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><caption className="sr-only">TAB batch review</caption><thead><tr>{['Race', 'Start (Melbourne)', 'Runner', 'Market', 'Model', 'Stake'].map(label => <th key={label} className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index} className="border-t border-slate-200"><td className="px-2 py-2">{row.race}</td><td className="px-2">{time(row.start)}</td><td className="px-2">{row.runner}. {row.horse}</td><td className="px-2">{row.market}</td><td className="px-2">{row.model}</td><td className="px-2 tabular-nums">{money(row.stake)}</td></tr>)}</tbody></table></div>}
      {preview.excluded.length > 0 && <details className="mt-3 text-xs text-slate-600"><summary>{preview.excluded.length} withheld selections</summary><ul className="mt-2 space-y-1">{preview.excluded.map((row, index) => <li key={index}>{row.race}, {row.horse}: {row.reason}</li>)}</ul></details>}
    </>}
  </section>
}