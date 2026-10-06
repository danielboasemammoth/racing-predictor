'use client'

import { startTransition, useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Download, History, RefreshCw, RotateCcw, TrendingUp } from 'lucide-react'
import { DEFAULT_SIMULATION_FILTERS, simulateBets, simulationCandidates, simulationBetProvider, type SimulationBet, type SimulationDataset, type SimulationFilters, type SimulationMarket, type SimulationSettings } from '@/lib/betting/historical-simulator'
import { readSimulationChunks, readSimulationManifest, simulationReportBaseUrl } from '@/lib/betting/simulation-report'
import { DEFAULT_SIMULATION_SETTINGS, readSimulationPreferences, SIMULATION_PREFERENCES_KEY } from '@/lib/betting/simulation-preferences'
import { StrategySettings } from './strategy-settings'
import { legacySimulationPreset } from '@/lib/betting/simulation-presets'
import { findProfitSuggestion, type ProfitSuggestion } from '@/lib/betting/simulation-optimizer'
import { TabPlaceResearch } from './tab-place-research'

const amounts = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
const money = (amount: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount)
const percent = (amount: number | null) => amount === null ? '-' : `${amount.toFixed(1)}%`
const date = (value: string) => new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

function Select({ label, value, onChange, children }: { label: string; value: string | number; onChange: (value: string) => void; children: ReactNode }) {
  return <label className="min-w-0 text-xs font-medium text-slate-600">{label}<select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className="mt-1 block h-9 w-full min-w-0 rounded border border-slate-300 bg-white px-2 text-sm text-slate-900">{children}</select></label>
}

function Filters({ market, value, setValue, models, venues, suggestion, searching }: { market: SimulationMarket; value: SimulationFilters; setValue: (value: SimulationFilters) => void; models: string[]; venues: string[]; suggestion: ProfitSuggestion | null; searching: boolean }) {
  const update = (key: keyof SimulationFilters, next: string | number | boolean) => setValue({ ...value, [key]: next })
  const [notice, setNotice] = useState('')
  const comparison = value.inclusiveThresholds ? '>=' : '>'
  return <fieldset className={`min-w-0 border-t-4 py-4 ${market === 'PLACE' ? 'border-teal-600' : 'border-amber-500'}`}>
    <legend className="sr-only">{market} filters</legend>
    <div className="mb-3 flex items-center justify-between"><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={value.enabled} onChange={event => update('enabled', event.target.checked)} className="accent-teal-700" />{market}</label>
      <div className="flex gap-2">
        <button type="button" title={`Apply legacy internal ${market} policy`} aria-label={`Apply legacy internal ${market} policy`} onClick={() => { setValue(legacySimulationPreset(market)); setNotice('Legacy internal policy applied. Only frozen WIN qualification is accepted; full-field PLACE requires the updated report. Missing evidence is excluded.') }} className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 hover:bg-white"><History size={15} /></button>
        <button type="button" title={`Apply historical profit ${market} preset`} aria-label={`Apply historical profit ${market} preset`} disabled={searching || !suggestion} onClick={() => { if (suggestion?.eligible && suggestion.filter) setValue({ ...suggestion.filter }); setNotice(suggestion?.reason ?? 'Report unavailable.') }} className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 hover:bg-white disabled:opacity-40"><TrendingUp size={15} /></button>
        <button type="button" title={`Reset ${market} filters`} aria-label={`Reset ${market} filters`} onClick={() => { setValue({ ...DEFAULT_SIMULATION_FILTERS }); setNotice('') }} className="flex h-8 w-8 items-center justify-center rounded border border-slate-300 hover:bg-white"><RotateCcw size={15} /></button>
      </div></div>
    {notice && <p role="status" className="mb-3 text-xs text-slate-600">{notice}</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Select label={`${market} model`} value={value.model} onChange={next => update('model', next)}><option value="">All models</option>{value.model && !models.includes(value.model) && <option value={value.model}>{value.model} (unavailable)</option>}{models.map(model => <option key={model}>{model}</option>)}</Select>
      <Select label={`${market} reliability`} value={value.minReliability} onChange={next => update('minReliability', Number(next))}>{amounts.map(amount => <option key={amount} value={amount}>{amount ? `${amount}+ (pre-race)` : 'Any / unavailable'}</option>)}</Select>
      <Select label={`${market} edge`} value={value.minEdge} onChange={next => update('minEdge', Number(next))}><option value={-100}>Any / unavailable</option>{[-20, -15, -10, -5, -2, 0, 2, 5, 10, 15, 20].map(amount => <option key={amount} value={amount}>{`${comparison} ${amount} pts`}</option>)}</Select>
      <Select label={`${market} win probability`} value={value.minWin} onChange={next => update('minWin', Number(next))}>{amounts.map(amount => <option key={amount} value={amount}>{amount ? `${comparison} ${amount}%` : 'Any'}</option>)}</Select>
      <Select label={`${market} top-three probability`} value={value.minTop3} onChange={next => update('minTop3', Number(next))}>{amounts.map(amount => <option key={amount} value={amount}>{amount ? `${comparison} ${amount}%` : 'Any'}</option>)}</Select>
      <Select label={`${market} predicted rank`} value={value.rank} onChange={next => update('rank', Number(next))}><option value={0}>Any within scope</option>{[1, 2, 3].map(rank => <option key={rank} value={rank}>{rank}</option>)}</Select>
      <Select label={`${market} implied minimum`} value={value.minImplied} onChange={next => update('minImplied', Number(next))}>{amounts.map(amount => <option key={amount} value={amount}>{amount}%</option>)}</Select>
      <Select label={`${market} implied maximum`} value={value.maxImplied} onChange={next => update('maxImplied', Number(next))}>{[...amounts.slice(1), 100].map(amount => <option key={amount} value={amount}>{amount}%</option>)}</Select>
      <Select label={`${market} odds source`} value={value.source} onChange={next => update('source', next)}><option value="">Latest forecast / near-start</option><option value="tab">TAB near-start</option><option value="tab_decision">TAB at decision time</option><option value="racing_com">Racing.com recorded</option></Select>
      <Select label={`${market} minimum odds`} value={value.minOdds} onChange={next => update('minOdds', Number(next))}>{[0, 1.5, 2, 3, 5, 10].map(amount => <option key={amount} value={amount}>{amount || 'Any'}</option>)}</Select>
      <Select label={`${market} maximum odds`} value={value.maxOdds} onChange={next => update('maxOdds', Number(next))}>{[0, 2, 3, 5, 10, 15, 20, 50].map(amount => <option key={amount} value={amount}>{amount || 'Any'}</option>)}</Select>
      <Select label={`${market} field size`} value={value.maxField} onChange={next => update('maxField', Number(next))}>{[0, 5, 7, 8, 9, 10, 12, 16].map(amount => <option key={amount} value={amount}>{amount ? `< ${amount} starters` : 'Any'}</option>)}</Select>
      <Select label={`${market} minimum field size`} value={value.minimumFieldSize} onChange={next => update('minimumFieldSize', Number(next))}>{[0, 5, 7, 8, 10, 12, 16].map(amount => <option key={amount} value={amount}>{amount ? `${amount}+ starters` : 'Any'}</option>)}</Select>
      <Select label={`${market} minimum TAB market rank`} value={value.minTabMarketRank ?? 0} onChange={next => update('minTabMarketRank', Number(next))}>{[0, 1, 2, 5].map(rank => <option key={rank} value={rank}>{rank ? `${rank}+` : 'Any'}</option>)}</Select>
      <Select label={`${market} maximum TAB market rank`} value={value.maxTabMarketRank ?? 0} onChange={next => update('maxTabMarketRank', Number(next))}>{[0, 1, 4].map(rank => <option key={rank} value={rank}>{rank || 'Any'}</option>)}</Select>
      <Select label={`${market} runner scope`} value={value.maxRank} onChange={next => update('maxRank', Number(next))}><option value={3}>Predicted top three</option><option value={0}>Complete forecast field</option></Select>
      <Select label={`${market} minimum minutes to jump`} value={value.minMinutesToJump} onChange={next => update('minMinutesToJump', Number(next))}>{[0, 1, 2, 5, 10, 15, 30, 60, 180].map(amount => <option key={amount} value={amount}>{amount || 'Any'}</option>)}</Select>
      <Select label={`${market} maximum minutes to jump`} value={value.maxMinutesToJump} onChange={next => update('maxMinutesToJump', Number(next))}>{[0, 1, 2, 5, 10, 15, 30, 60, 180].map(amount => <option key={amount} value={amount}>{amount || 'Any'}</option>)}</Select>
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={value.inclusiveThresholds} onChange={event => update('inclusiveThresholds', event.target.checked)} />Inclusive edge / probability floors</label>
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={value.requireQualifiedWin} onChange={event => update('requireQualifiedWin', event.target.checked)} />Verified pre-race WIN qualification</label>
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={value.positiveValueOnly} onChange={event => update('positiveValueOnly', event.target.checked)} />Positive expected value only</label>
      <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={value.onePerRace ?? false} onChange={event => update('onePerRace', event.target.checked)} />One highest-value pick per race / model</label>
      <div className="col-span-2 sm:col-span-3"><Select label={`${market} venue`} value={value.venue} onChange={next => update('venue', next)}><option value="">All venues</option>{value.venue && !venues.includes(value.venue) && <option value={value.venue}>{value.venue} (unavailable)</option>}{venues.map(venue => <option key={venue}>{venue}</option>)}</Select></div>
    </div>
    <p className="mt-3 text-xs text-slate-600">{searching ? 'Evaluating historical profit...' : suggestion ? `${suggestion.reason} Training: ${money(suggestion.trainProfit)} / ${suggestion.trainRaces} races. Holdout: ${money(suggestion.holdoutProfit)} / ${suggestion.holdoutRaces} races${suggestion.splitDate ? ` from ${suggestion.splitDate}` : ''}. ${suggestion.tested} configurations tested.` : 'Profit research awaits a published report.'}</p>
  </fieldset>
}

function exportBets(bets: SimulationBet[]) {
  const rows = [['Race', 'Start', 'Model', 'Rank', 'Horse', 'Market', 'Prediction time', 'Win probability', 'Top3 probability', 'Reliability', 'Implied probability', 'Edge points', 'Odds source', 'Odds provider', 'Odds', 'Finish', 'Status', 'Exclusion', 'Stake', 'Return', 'Profit', 'TAB quote time (reported age)', 'TAB capture time', 'Decision time', 'TAB market rank', 'Estimated return per dollar', 'Paid places', 'Paid-place probability', 'Terms verified', 'Top2 estimate', 'Trial version'], ...bets.map(bet => [
    `${bet.race.venue} R${bet.race.number}`, bet.race.start, bet.selection.model, bet.selection.rank, bet.selection.horse, bet.market, bet.selection.predictedAt,
    bet.selection.winProbability, bet.selection.top3Probability, bet.selection.reliability, bet.implied, bet.edge, bet.source, simulationBetProvider(bet), bet.odds, bet.selection.position, bet.status, bet.issue, bet.stake, bet.returned, bet.profit, bet.source.startsWith('tab') ? bet.selection.tabQuotedAt : null, bet.source.startsWith('tab') ? bet.selection.tabCapturedAt : null, bet.source === 'tab_decision' ? bet.selection.evaluatedAt : null,
    bet.tabMarketRank, bet.probability !== null && bet.odds !== null ? bet.probability * bet.odds - 1 : null,
    bet.selection.placePaidPlaces, bet.selection.placeProbability, bet.selection.placeTermsVerified ?? false, bet.selection.top2Probability, bet.race.tabPlaceResearch?.version,
  ])]
  const csv = rows.map(row => row.map(value => { const text = String(value ?? ''); return `"${(/^[=+@-]/.test(text) && typeof value === 'string' ? `'${text}` : text).replaceAll('"', '""')}"` }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'historical-simulation.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function HistoricalSimulator() {
  const [dataset, setDataset] = useState<SimulationDataset | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const generation = useRef('')
  const [filters, setFilters] = useState({ WIN: { ...DEFAULT_SIMULATION_FILTERS }, PLACE: { ...DEFAULT_SIMULATION_FILTERS } })
  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SIMULATION_SETTINGS)
  const [count, setCount] = useState(500)
  const [sort, setSort] = useState('start')
  const [pageNumber, setPageNumber] = useState(0)
  const [preferencesReady, setPreferencesReady] = useState(false)
  const [suggestions, setSuggestions] = useState<Record<SimulationMarket, ProfitSuggestion | null>>({ WIN: null, PLACE: null })
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (!dataset) return
    let cancelled = false
    startTransition(() => { setSearching(true); setSuggestions({ WIN: null, PLACE: null }) })
    async function research() {
      const races = dataset!.races.slice(0, count)
      const WIN = await findProfitSuggestion(races, 'WIN', settings, () => cancelled)
      const PLACE = await findProfitSuggestion(races, 'PLACE', settings, () => cancelled)
      if (!cancelled) startTransition(() => { setSuggestions({ WIN, PLACE }); setSearching(false) })
    }
    void research().catch(() => { if (!cancelled) startTransition(() => setSearching(false)) })
    return () => { cancelled = true }
  }, [dataset, settings, count])
  useEffect(() => {
    let saved: string | null = null
    try { saved = window.localStorage.getItem(SIMULATION_PREFERENCES_KEY) } catch {}
    const preferences = readSimulationPreferences(saved)
    startTransition(() => {
      setFilters(preferences.filters)
      setSettings(preferences.settings)
      setCount(preferences.count)
      setSort(preferences.sort)
      setPreferencesReady(true)
    })
  }, [])
  useEffect(() => {
    if (!preferencesReady) return
    try {
      window.localStorage.setItem(SIMULATION_PREFERENCES_KEY, JSON.stringify({ schema: 1, filters, settings, count, sort }))
    } catch {}
  }, [preferencesReady, filters, settings, count, sort])
  useEffect(() => {
    let active = true
    let running = false
    async function load() {
      if (running) return
      running = true
      setLoading(true)
      try {
        const baseUrl = simulationReportBaseUrl()
        const manifest = await readSimulationManifest(baseUrl)
        if (!manifest) throw new Error('No simulator report published yet. The database migration and first report refresh are required.')
        if (manifest.generatedAt !== generation.current) {
          const next = await readSimulationChunks(baseUrl, manifest)
          if (active) { generation.current = manifest.generatedAt; startTransition(() => { setDataset(next); setPageNumber(0) }) }
        }
        if (active) setError('')
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Report unavailable; last successful data retained.')
      } finally { running = false; if (active) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => void load(), 15 * 60_000)
    return () => { active = false; clearInterval(timer) }
  }, [refresh])

  const deferred = useDeferredValue({ filters, settings, count })
  const races = (dataset?.races ?? []).slice(0, deferred.count)
  const candidates = simulationCandidates(races)
  const result = simulateBets(candidates, deferred.filters, deferred.settings)
  const displayed = result.bets.filter(bet => bet.status !== 'EXCLUDED').sort((left, right) => sort === 'profit' ? right.profit - left.profit || left.id.localeCompare(right.id) : sort === 'edge' ? (right.edge ?? -Infinity) - (left.edge ?? -Infinity) || left.id.localeCompare(right.id) : right.race.start.localeCompare(left.race.start) || left.id.localeCompare(right.id))
  const totalPages = Math.max(1, Math.ceil(displayed.length / 50))
  const currentPage = Math.min(pageNumber, totalPages - 1)
  const visible = displayed.slice(currentPage * 50, (currentPage + 1) * 50)
  const venues = [...new Set((dataset?.races ?? []).map(race => race.venue))].sort()
  const stake = result.summaries.reduce((total, summary) => total + summary.staked, 0)
  const profit = result.summaries.reduce((total, summary) => total + summary.profit, 0)
  const settled = result.summaries.reduce((total, summary) => total + summary.bets, 0)
  const updateFilter = (market: SimulationMarket, value: SimulationFilters) => { setFilters(previous => ({ ...previous, [market]: value })); setPageNumber(0) }
  const updateSetting = (key: keyof SimulationSettings, value: number | string) => { setSettings(previous => ({ ...previous, [key]: value })); setPageNumber(0) }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
      <p role="status">{dataset ? `Snapshot: ${date(dataset.generatedAt)} (Melbourne)${loading ? ' / checking for updates' : ''}` : loading ? 'Loading historical report...' : 'Report unavailable'}</p>
      <button type="button" title="Refresh report" aria-label="Refresh report" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
    </div>
    {error && <p role="alert" className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-950">{error}{dataset ? ' Showing the last successfully loaded report.' : ''}</p>}
    <StrategySettings preferences={{ schema: 1, filters, settings, count, sort }} onLoad={value => { setFilters(value.filters); setSettings(value.settings); setCount(value.count); setSort(value.sort); setPageNumber(0) }} />
    <div className="border-y border-slate-200 py-4"><div className="grid grid-cols-2 gap-4 md:grid-cols-5">
      <Select label="Completed races" value={count} onChange={value => { setCount(Number(value)); setPageNumber(0) }}>{[100, 250, 500, 1000].map(value => <option key={value}>{value}</option>)}</Select>
      <label className="text-xs font-medium text-slate-600">Starting bankroll per model<input aria-label="Starting bankroll per model" type="number" min="0" step="50" value={settings.startingBankroll} onChange={event => updateSetting('startingBankroll', Math.max(0, Number(event.target.value)))} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-900" /></label>
      <Select label="Staking method" value={settings.method} onChange={value => updateSetting('method', value)}><option value="flat">Flat dollar stake</option><option value="percent">Percentage of available bankroll</option><option value="kelly-0.10">0.10 Kelly (5% cap)</option><option value="kelly-0.25">0.25 Kelly (5% cap)</option></Select>
      <label className="text-xs font-medium text-slate-600">Flat stake ($)<input aria-label="Flat stake" type="number" min="0" step="1" disabled={settings.method !== 'flat'} value={settings.flatStake} onChange={event => updateSetting('flatStake', Math.max(0, Number(event.target.value)))} className="mt-1 h-9 w-full rounded border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:opacity-40" /></label>
      <Select label="Stake percentage" value={settings.stakePercent} onChange={value => updateSetting('stakePercent', Number(value))}>{[0.5, 1, 2, 3, 5, 10].map(value => <option key={value} value={value}>{value}%</option>)}</Select>
    </div></div>
    <div className="grid gap-x-8 lg:grid-cols-2">{(['WIN', 'PLACE'] as const).map(market => <Filters key={market} market={market} value={filters[market]} setValue={value => updateFilter(market, value)} models={dataset?.models ?? []} venues={venues} suggestion={suggestions[market]} searching={searching} />)}</div>
    <p className="text-xs text-slate-600">Legacy presets track the internal policy constants, not the separate PuntersEdge consensus model. Old WIN qualification is unavailable; new observer runs freeze pre-race evidence. Time filters require a frozen evaluation or recorded TAB capture. Full-field replay needs the updated source migration and report. Suggestions refresh with report data and staking; saved strategies and real-betting drafts never update automatically.</p>
    {(['WIN', 'PLACE'] as const).some(market => filters[market].source === 'tab_decision') && <p role="status" className="border-l-4 border-teal-600 bg-teal-50 p-3 text-xs text-teal-950">{races.filter(race => race.decisionSelections?.length).length} of {races.length} races have frozen decision observations. First valid quote observation per race/model, 1-180 minutes before start; forecast and quotes frozen together. Quotes must be at most two minutes old at the observation. Missing history is excluded, never replaced with near-start prices. Filters test that fixed observation, not a later qualifying price.</p>}
    <p className="border-l-4 border-slate-300 pl-3 text-xs leading-relaxed text-slate-600">Recorded-price simulation, not actual TAB settlements or guaranteed executable returns. Near-start TAB quotes come from the final 10 minutes and are at most two minutes old when captured; decision-time prices come from the frozen earlier observation. Neither is an accepted bet price or an official closing price. Reliability is available only from frozen pre-race observations. Legacy PLACE replay assumes three paid places in unchanged fields of eight or more; two-place replay requires frozen verified terms and a matching probability. Each race settles before the next is replayed; overlapping races and database ingestion delays do not reserve cash. Each model has its own bankroll. No real or paper bets are placed.</p>
    <section aria-label="Simulation results" className="border-y border-slate-200 bg-white py-5">
      <p className="mb-4 px-4 text-xs text-slate-600">Racing.com prices are the highest recorded quotes across its provider feed, selected separately for WIN and PLACE, not one bookmaker or necessarily fixed odds. Provider codes are retained from the forecast; older snapshots without attribution show Provider not recorded. Higher simulated returns are not proof those prices were available to bet.</p>
      <div className="grid grid-cols-2 gap-4 px-4 md:grid-cols-4">{[
        ['Settled bets', String(settled)], ['Total stake', money(stake)], ['Net profit', money(profit)], ['Filtered ROI', percent(stake ? profit / stake * 100 : null)],
      ].map(([label, value]) => <div key={label}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p></div>)}</div>
      <p className="mt-4 px-4 text-xs text-slate-600">{races.length} / {count} requested races loaded; {races.filter(race => race.selections.length).length} with eligible pre-race forecasts. {candidates.length} candidate bets; {result.bets.length} match filters. {result.summaries.reduce((total, summary) => total + summary.excluded, 0)} excluded (hidden from table and export); {result.summaries.reduce((total, summary) => total + summary.refunded, 0)} refunded; {result.summaries.reduce((total, summary) => total + summary.unfunded, 0)} unfunded. ROI covers all filtered settled rows across separate model portfolios, not just this page.</p>
    </section>
    <section aria-label="Model comparison" className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><caption className="mb-3 text-left font-semibold">Model portfolios</caption><thead className="border-b text-xs text-slate-500"><tr>{['Model', 'Bets', 'Races', 'Hit rate', 'Profit', 'ROI', 'Bankroll', 'Max drawdown'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{result.summaries.map(summary => <tr key={summary.model} className="border-b border-slate-200 tabular-nums"><th className="px-3 py-3 font-medium">{summary.model}</th><td className="px-3">{summary.bets}</td><td className="px-3">{summary.races}</td><td className="px-3">{percent(summary.bets ? summary.wins / summary.bets * 100 : null)}</td><td className={`px-3 ${summary.profit < 0 ? 'text-red-700' : 'text-teal-800'}`}>{money(summary.profit)}</td><td className="px-3">{percent(summary.roi)}</td><td className="px-3">{money(summary.bankroll)}</td><td className="px-3">{percent(summary.maxDrawdown)}</td></tr>)}</tbody></table></section>
    <TabPlaceResearch races={dataset?.races ?? []} onExport={exportBets} />
    <section aria-label="Filtered bets">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><h3 className="font-semibold">Filtered bets ({displayed.length})</h3><div className="flex items-end gap-3"><Select label="Sort results" value={sort} onChange={value => { setSort(value); setPageNumber(0) }}><option value="start">Race time: newest</option><option value="profit">Profit: highest</option><option value="edge">Edge: highest</option></Select><button type="button" title="Export all filtered bets" aria-label="Export all filtered bets" disabled={!displayed.length} onClick={() => exportBets(displayed)} className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white disabled:opacity-40"><Download size={16} /></button></div></div>
      {!displayed.length ? <p className="border-y border-slate-200 py-8 text-center text-sm text-slate-600">{dataset ? 'No eligible bets match the current filters.' : 'Historical bets will appear after a successful report publication.'}</p> : <div className="overflow-x-auto" tabIndex={0} aria-label="Bet results table"><table className="w-full min-w-[1760px] text-left text-xs"><thead className="border-y border-slate-200 bg-slate-100"><tr>{['Race / start', 'Model / rank', 'Horse', 'Market', 'Win %', 'Top 3 %', 'Reliability', 'Implied %', 'Edge pts', 'Odds / source', 'Finish', 'Result', 'Stake', 'Return', 'Profit', 'Odds provider'].map(label => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{visible.map(bet => <tr key={bet.id} className="border-b border-slate-200 bg-white tabular-nums hover:bg-slate-50">
        <td className="px-3 py-3"><Link href={`/races/${bet.race.id}`} prefetch={false} className="font-semibold text-teal-800">{bet.race.venue} R{bet.race.number}</Link><p className="mt-1 text-slate-500">{date(bet.race.start)}</p></td><td className="px-3">{bet.selection.model}<p className="text-slate-500">Rank {bet.selection.rank}</p></td><td className="px-3 font-medium" title={`Forecast: ${date(bet.selection.predictedAt)}`}>{bet.selection.horse}</td><td className={`px-3 font-semibold ${bet.market === 'PLACE' ? 'text-teal-800' : 'text-amber-800'}`}>{bet.market}</td><td className="px-3">{percent(bet.selection.winProbability === null ? null : bet.selection.winProbability * 100)}</td><td className="px-3">{percent(bet.selection.top3Probability === null ? null : bet.selection.top3Probability * 100)}</td><td className="px-3">{bet.selection.reliability ?? '-'}</td><td className="px-3">{percent(bet.implied === null ? null : bet.implied * 100)}</td><td className="px-3">{bet.edge?.toFixed(1) ?? '-'}</td><td className="px-3">{bet.odds?.toFixed(2) ?? '-'}<p className="text-slate-500">{bet.source === 'tab_decision' ? 'TAB decision' : bet.source === 'tab' ? 'TAB near-start' : 'Racing.com'}</p>{bet.source === 'tab_decision' && bet.selection.evaluatedAt && <p className="text-slate-500">{date(bet.selection.evaluatedAt)}</p>}</td><td className="px-3">{bet.selection.scratched ? 'SCR' : bet.selection.position ?? '-'}</td><td className="max-w-48 px-3"><span className={bet.status === 'WON' ? 'text-teal-800' : bet.status === 'LOST' ? 'text-red-700' : 'text-slate-600'}>{bet.status.replaceAll('_', ' ')}</span>{bet.issue && <p className="mt-1 text-slate-500">{bet.issue}</p>}</td><td className="px-3">{money(bet.stake)}</td><td className="px-3">{money(bet.returned)}</td><td className={`px-3 ${bet.profit < 0 ? 'text-red-700' : 'text-teal-800'}`}>{money(bet.profit)}</td>
        <td className="min-w-40 max-w-48 break-words px-3">{simulationBetProvider(bet)}</td>
      </tr>)}</tbody></table></div>}
      <div className="mt-3 flex items-center justify-end gap-3 text-xs"><button type="button" title="Previous page" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPageNumber(currentPage - 1)} className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 disabled:opacity-40"><ChevronLeft size={16} /></button><span>Page {currentPage + 1} of {totalPages}</span><button type="button" title="Next page" aria-label="Next page" disabled={currentPage + 1 >= totalPages} onClick={() => setPageNumber(currentPage + 1)} className="flex h-9 w-9 items-center justify-center rounded border border-slate-300 disabled:opacity-40"><ChevronRight size={16} /></button></div>
    </section>
  </>
}