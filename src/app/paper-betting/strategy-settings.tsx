'use client'

import { startTransition, useEffect, useState } from 'react'
import { Download, FolderOpen, Save, Trash2 } from 'lucide-react'
import { readSavedStrategies, saveStrategy, SAVED_STRATEGIES_KEY, type SavedStrategy } from '@/lib/betting/saved-strategies'
import type { SimulationPreferences } from '@/lib/betting/simulation-preferences'

export function StrategySettings({ preferences, onLoad }: { preferences: SimulationPreferences; onLoad: (value: SimulationPreferences) => void }) {
  const [saved, setSaved] = useState<SavedStrategy[]>([])
  const [name, setName] = useState('My strategy')
  const [selected, setSelected] = useState('')
  const [notice, setNotice] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let entries: SavedStrategy[] = []
    try { entries = readSavedStrategies(window.localStorage.getItem(SAVED_STRATEGIES_KEY)) } catch {}
    startTransition(() => { setSaved(entries); setSelected(entries[0]?.name ?? ''); setReady(true) })
  }, [])
  const current = saved.find(entry => entry.name === selected)
  function persist(entries: SavedStrategy[]) {
    window.localStorage.setItem(SAVED_STRATEGIES_KEY, JSON.stringify(entries))
    setSaved(entries)
  }
  function save() {
    try {
      const entries = readSavedStrategies(window.localStorage.getItem(SAVED_STRATEGIES_KEY))
      if (entries.some(entry => entry.name === name.trim()) && !window.confirm(`Replace saved strategy "${name.trim()}"?`)) return
      persist(saveStrategy(entries, name, preferences))
      setSelected(name.trim())
      setNotice(`Saved "${name.trim()}" on this browser. Real-betting drafts are unchanged.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save settings.') }
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
      <button type="button" disabled={!ready} onClick={save} className={button}><Save size={16} />Save settings</button>
      <label className="min-w-0 text-xs font-medium text-slate-600">Saved strategy<select aria-label="Saved strategy" value={selected} onChange={event => setSelected(event.target.value)} className="mt-1 block h-9 w-48 max-w-full rounded border border-slate-300 bg-white px-2 text-sm"><option value="">Select strategy</option>{saved.map(entry => <option key={entry.name}>{entry.name}</option>)}</select></label>
      <button type="button" title="Load saved settings" aria-label="Load saved settings" disabled={!current} onClick={() => { if (current) { onLoad(structuredClone(current.preferences)); setName(current.name); setNotice(`Loaded "${current.name}".`) } }} className={button}><FolderOpen size={16} /></button>
      <button type="button" title="Export saved strategy" aria-label="Export saved strategy" disabled={!current} onClick={download} className={button}><Download size={16} /></button>
      <button type="button" title="Delete saved strategy" aria-label="Delete saved strategy" disabled={!current} onClick={() => {
        if (!current || !window.confirm(`Delete saved strategy "${current.name}"?`)) return
        try { const entries = readSavedStrategies(window.localStorage.getItem(SAVED_STRATEGIES_KEY)).filter(entry => entry.name !== current.name); persist(entries); setSelected(entries[0]?.name ?? ''); setNotice('Saved strategy deleted. Real-betting drafts are unchanged.') } catch { setNotice('Could not delete saved strategy.') }
      }} className={button}><Trash2 size={16} /></button>
    </div>
    {notice && <p role="status" className="mt-2 text-xs text-slate-600">{notice}</p>}
  </section>
}