'use client'

import { startTransition, useEffect, useState } from 'react'
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react'
import { readSavedStrategies, SAVED_STRATEGIES_KEY } from '@/lib/betting/saved-strategies'
import {
  buildRunnerConfig, DEFAULT_RISK_LIMITS, loopbackOrigin, parseRiskLimits, parseRunnerConfig, parseStrategy, RISK_LIMIT_CEILINGS,
  type RealBettingRiskLimits, type RealBettingStrategy,
} from '@/lib/real-betting/config'

export const REAL_BETTING_DRAFT_KEY = 'real-betting:draft:v1'

const money = (amount: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount)
const date = (value: string) => new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const button = 'inline-flex h-9 items-center gap-2 rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50'

function readDraft(): { strategy: RealBettingStrategy | null; limits: RealBettingRiskLimits } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(REAL_BETTING_DRAFT_KEY) ?? 'null') as { strategy?: unknown; limits?: unknown } | null
    const strategy = parseStrategy(saved?.strategy)
    const limits = parseRiskLimits(saved?.limits)
    return { strategy: strategy.ok ? strategy.value : null, limits: limits.ok ? limits.value : DEFAULT_RISK_LIMITS }
  } catch {
    return { strategy: null, limits: DEFAULT_RISK_LIMITS }
  }
}

function readSavedList(): RealBettingStrategy[] {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(SAVED_STRATEGIES_KEY) } catch {}
  return readSavedStrategies(raw).flatMap(strategy => {
    const parsed = parseStrategy(strategy)
    return parsed.ok ? [parsed.value] : []
  })
}

function StrategySummary({ strategy }: { strategy: RealBettingStrategy }) {
  const { filters, settings } = strategy.preferences
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
    <div><dt className="text-xs text-slate-500">Name</dt><dd className="font-medium break-words">{strategy.name}</dd></div>
    <div><dt className="text-xs text-slate-500">Saved</dt><dd>{date(strategy.savedAt)}</dd></div>
    <div><dt className="text-xs text-slate-500">Markets</dt><dd>{(['WIN', 'PLACE'] as const).filter(market => filters[market].enabled).join(' + ') || 'None enabled'}</dd></div>
    <div><dt className="text-xs text-slate-500">Simulated staking</dt><dd>{settings.method === 'flat' ? `Flat ${money(settings.flatStake)}` : settings.method === 'percent' ? `${settings.stakePercent}% of bankroll` : settings.method}</dd></div>
    {(['WIN', 'PLACE'] as const).filter(market => filters[market].enabled).map(market => <div key={market} className="col-span-2 break-words sm:col-span-4 text-xs text-slate-600">
      <span className="font-semibold text-slate-800">{market}:</span> edge {filters[market].inclusiveThresholds ? '>=' : '>'} {filters[market].minEdge === -100 ? 'any' : `${filters[market].minEdge} pts`}, win {filters[market].inclusiveThresholds ? '>=' : '>'} {filters[market].minWin}%, top-three {filters[market].inclusiveThresholds ? '>=' : '>'} {filters[market].minTop3}%, reliability {filters[market].minReliability || 'any'}, odds {filters[market].minOdds || 'any'}-{filters[market].maxOdds || 'any'}, model {filters[market].model || 'all'}, venue {filters[market].venue || 'all'}. Field {filters[market].minimumFieldSize || 'any'} to {filters[market].maxField ? `< ${filters[market].maxField}` : 'any'}, rank {filters[market].rank || 'any'} within {filters[market].maxRank ? 'top three' : 'complete field'}, capture window {filters[market].minMinutesToJump || 'any'}-{filters[market].maxMinutesToJump || 'any'} minutes; verified WIN qualification {filters[market].requireQualifiedWin ? 'required' : 'not required'}.
      <p>Positive EV {filters[market].positiveValueOnly ? 'required' : 'not required'}; implied probability {filters[market].minImplied}-{filters[market].maxImplied}%; price source {filters[market].source || 'all recorded prices'}.</p>
    </div>)}
  </dl>
}

function LimitInput({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (value: number) => void }) {
  return <label className="text-xs font-medium text-slate-600">{label}
    <input type="number" min={0.5} max={max} step={0.5} value={value} onChange={event => onChange(Number(event.target.value))} className="mt-1 block h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-900" />
  </label>
}

export function StrategyDraft() {
  const [saved, setSaved] = useState<RealBettingStrategy[]>([])
  const [selected, setSelected] = useState(0)
  const [draft, setDraft] = useState<RealBettingStrategy | null>(null)
  const [limits, setLimits] = useState<RealBettingRiskLimits>(DEFAULT_RISK_LIMITS)
  const [ready, setReady] = useState(false)
  const [importText, setImportText] = useState('')
  const [notice, setNotice] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    const stored = readDraft()
    const list = readSavedList()
    startTransition(() => {
      setSaved(list)
      setDraft(stored.strategy)
      setLimits(stored.limits)
      setReady(true)
    })
  }, [])

  useEffect(() => {
    if (!ready) return
    try { window.localStorage.setItem(REAL_BETTING_DRAFT_KEY, JSON.stringify({ strategy: draft, limits })) } catch {}
  }, [ready, draft, limits])

  const limitCheck = parseRiskLimits(limits)
  const report = (message: string, problems: string[] = []) => { setNotice(message); setErrors(problems) }

  function applySelected() {
    const strategy = saved[selected]
    if (!strategy) return report('', ['Select a saved strategy first'])
    setDraft(structuredClone(strategy))
    report(`Draft set to "${strategy.name}". Later simulator changes will not alter this draft.`)
  }

  function importJson() {
    let value: unknown
    try { value = JSON.parse(importText) } catch { return report('', ['Import is not valid JSON']) }
    const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
    if ('provider' in record || 'mode' in record) {
      const config = parseRunnerConfig(value)
      if (!config.ok) return report('', config.errors)
      setDraft(config.value.strategy)
      setLimits(config.value.limits)
      setImportText('')
      return report(`Imported runner config "${config.value.strategy.name}" as a local draft. Its mode was not applied; exports are always disabled.`)
    }
    const strategy = parseStrategy(value)
    if (!strategy.ok) return report('', strategy.errors)
    setDraft(strategy.value)
    setImportText('')
    report(`Imported strategy "${strategy.value.name}" as a local draft.`)
  }

  function exportConfig() {
    if (!draft || !limitCheck.ok) return
    const config = buildRunnerConfig(draft, limitCheck.value, crypto.randomUUID(), new Date())
    config.appUrl = loopbackOrigin(window.location.origin) ?? config.appUrl
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(config, null, 2)}\n`], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'real-betting-runner.json'
    anchor.click()
    URL.revokeObjectURL(url)
    report('Exported a disabled runner config. Save it to %LOCALAPPDATA%\\RacingPredictor\\real-betting-runner.json.')
  }

  return <section className="space-y-5">
    <div className="border-y border-slate-200 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Saved simulator strategies</h2>
        <button type="button" className={button} onClick={() => { setSaved(readSavedList()); setSelected(0); report('Saved strategy list reloaded. The current draft was not changed.') }}><RefreshCw size={15} />Reload list</button>
      </div>
      {!ready ? <p className="text-sm text-slate-500">Loading saved strategies...</p>
        : saved.length === 0 ? <p className="text-sm text-slate-600">No saved strategies found in this browser. Save one from the Paper Betting simulator, or import JSON below.</p>
        : <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">Strategy
            <select value={selected} onChange={event => setSelected(Number(event.target.value))} className="mt-1 block h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-900">
              {saved.map((strategy, index) => <option key={`${strategy.name}-${strategy.savedAt}-${index}`} value={index}>{strategy.name} ({date(strategy.savedAt)})</option>)}
            </select>
          </label>
          <button type="button" className={button} onClick={applySelected}>Apply as draft</button>
        </div>}
    </div>

    <div className="border-b border-slate-200 pb-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Local draft</h2>
        {draft && <button type="button" className={button} onClick={() => { setDraft(null); report('Draft cleared.') }}><Trash2 size={15} />Clear</button>}
      </div>
      {draft ? <StrategySummary strategy={draft} /> : <p className="text-sm text-slate-600">No draft selected. Nothing is active.</p>}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LimitInput label="Max stake per bet (AUD)" value={limits.maxStake} max={RISK_LIMIT_CEILINGS.maxStake} onChange={maxStake => setLimits({ ...limits, maxStake })} />
        <LimitInput label="Max staked per day (AUD)" value={limits.maxDailyStake} max={RISK_LIMIT_CEILINGS.maxDailyStake} onChange={maxDailyStake => setLimits({ ...limits, maxDailyStake })} />
        <LimitInput label="Max open exposure (AUD)" value={limits.maxOpenExposure} max={RISK_LIMIT_CEILINGS.maxOpenExposure} onChange={maxOpenExposure => setLimits({ ...limits, maxOpenExposure })} />
      </div>
      {!limitCheck.ok && <ul className="mt-2 list-disc pl-5 text-sm text-red-700">{limitCheck.errors.map(error => <li key={error}>{error}</li>)}</ul>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={button} disabled={!draft || !limitCheck.ok} onClick={exportConfig}><Download size={15} />Export runner config</button>
        <span className="text-xs text-slate-500">Exports are always mode &quot;disabled&quot; with enabled false. No credentials are included.</span>
      </div>
    </div>

    <div className="border-b border-slate-200 pb-4">
      <h2 className="mb-2 text-base font-semibold">Import JSON</h2>
      <p className="mb-2 text-xs text-slate-500">Paste a saved strategy or a runner config. Imports only replace the local draft.</p>
      <textarea aria-label="Strategy or runner config JSON" value={importText} onChange={event => setImportText(event.target.value)} rows={5} spellCheck={false} className="block w-full rounded border border-slate-300 bg-white p-2 font-mono text-xs text-slate-900" />
      <button type="button" className={`${button} mt-2`} disabled={!importText.trim()} onClick={importJson}><Upload size={15} />Import as draft</button>
    </div>

    {(notice || errors.length > 0) && <div role="status" className={`rounded border p-3 text-sm ${errors.length ? 'border-red-200 bg-red-50 text-red-800' : 'border-teal-200 bg-teal-50 text-teal-900'}`}>
      {notice && <p>{notice}</p>}
      {errors.length > 0 && <ul className="list-disc pl-5">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
    </div>}
  </section>
}
