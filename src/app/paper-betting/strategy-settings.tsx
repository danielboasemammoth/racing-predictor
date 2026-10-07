'use client'

import { startTransition, useEffect, useState } from 'react'
import Link from 'next/link'
import { Download, FolderOpen, RefreshCw, Save, Trash2 } from 'lucide-react'
import { loadSavedStrategies, readSavedStrategies, SAVED_STRATEGIES_KEY, type SavedStrategy } from '@/lib/betting/saved-strategies'
import type { SimulationPreferences } from '@/lib/betting/simulation-preferences'
import { picksHistoryPreset } from '@/lib/betting/simulation-presets'

export function StrategySettings({ preferences, onLoad }: { preferences: SimulationPreferences; onLoad: (value: SimulationPreferences) => void }) {
  const [saved, setSaved] = useState<SavedStrategy[]>([])
  const [name, setName] = useState('My strategy')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [ready, setReady] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [legacy, setLegacy] = useState<SavedStrategy[]>([])
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    void loadSavedStrategies().then(({ strategies, canEdit }) => {
      if (active) startTransition(() => { setSaved(strategies); setSelected(previous => strategies.some(entry => entry.name === previous) ? previous : ''); setCanEdit(canEdit); setReady(true); setNotice('') })
    }).catch(error => { if (active) { setNotice(error.message); setReady(false) } })
    try {
      const entries = readSavedStrategies(window.localStorage.getItem(SAVED_STRATEGIES_KEY))
      startTransition(() => setLegacy(entries))
    } catch {}
    return () => { active = false }
  }, [refresh])
  const current = saved.find(entry => entry.name === selected)
  async function write(method: 'POST' | 'DELETE', body: unknown) {
    const response = await fetch('/api/betting-strategies', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.message ?? 'Could not update saved strategies.')
    return result
  }
  async function save() {
    if (saved.some(entry => entry.name === name.trim()) && !window.confirm(`Replace shared strategy "${name.trim()}"?`)) return
    setBusy(true)
    try {
      const { strategy } = await write('POST', { name, preferences })
      setSaved(previous => [strategy, ...previous.filter(entry => entry.name !== strategy.name)])
      setSelected(strategy.name)
      setNotice(`Saved "${strategy.name}" to the database. Real-betting drafts are unchanged.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save settings.') }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!current || !window.confirm(`Delete shared strategy "${current.name}"?`)) return
    setBusy(true)
    try {
      await write('DELETE', { name: current.name })
      setSaved(previous => previous.filter(entry => entry.name !== current.name))
      setSelected('')
      setNotice('Shared strategy deleted. Real-betting drafts are unchanged.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not delete strategy.') }
    finally { setBusy(false) }
  }
  function download() {
    if (!current) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'betting-strategy.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const button = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded border border-slate-300 bg-white px-3 text-sm disabled:opacity-40'
  return <section aria-label="Saved strategies" className="border-y border-slate-200 py-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 text-xs font-medium text-slate-600">Strategy name<input aria-label="Strategy name" maxLength={120} value={name} onChange={event => setName(event.target.value)} className="mt-1 block h-9 w-48 max-w-full rounded border border-slate-300 bg-white px-2 text-sm" /></label>
      <button type="button" disabled={!ready || !canEdit || busy} onClick={save} className={button}><Save size={16} />Save settings</button>
      <button type="button" title="Reload shared strategies" aria-label="Reload shared strategies" disabled={busy} onClick={() => setRefresh(value => value + 1)} className={button}><RefreshCw size={16} /></button>
      <button type="button" onClick={() => { onLoad(picksHistoryPreset()); setName('Picks History - selection time'); setNotice('Loaded Picks History preset (WIN).') }} className={button}><FolderOpen size={16} />Picks History preset</button>
      <label className="min-w-0 text-xs font-medium text-slate-600">Saved strategy<select aria-label="Saved strategy" value={selected} onChange={event => setSelected(event.target.value)} className="mt-1 block h-9 w-48 max-w-full rounded border border-slate-300 bg-white px-2 text-sm"><option value="">Select strategy</option>{saved.map(entry => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <button type="button" title="Load saved settings" aria-label="Load saved settings" disabled={!current} onClick={() => { if (current) { onLoad(structuredClone(current.preferences)); setName(current.name); setNotice(`Loaded "${current.name}".`) } }} className={button}><FolderOpen size={16} /></button>
      <button type="button" title="Export saved strategy" aria-label="Export saved strategy" disabled={!current} onClick={download} className={button}><Download size={16} /></button>
      <button type="button" title="Delete saved strategy" aria-label="Delete saved strategy" disabled={!current || !canEdit || busy} onClick={remove} className={button}><Trash2 size={16} /></button>
    </div>
    {ready && !canEdit && <Link href="/admin" className="mt-2 inline-block text-xs text-teal-800 underline">Admin login required to save or delete</Link>}
    {legacy.length > 0 && <label className="mt-3 block text-xs text-slate-600">Legacy browser strategy<select aria-label="Legacy browser strategy" value="" onChange={event => {
      const entry = legacy.find(item => item.name === event.target.value)
      if (entry) { onLoad(structuredClone(entry.preferences)); setName(entry.name); setNotice(`Loaded local strategy "${entry.name}". Not yet saved to the database.`) }
    }} className="ml-2 h-9 max-w-full rounded border border-slate-300 bg-white px-2"><option value="">Select local strategy</option>{legacy.map(entry => <option key={entry.name}>{entry.name}</option>)}</select></label>}
    {notice && <p role="status" className="mt-2 text-xs text-slate-600">{notice}</p>}
  </section>
}