'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { BadgePercent, Check } from 'lucide-react'
import { bonusBackProbability, isBonusBackOffer, type BonusBackOffer } from '@/lib/betting/bonus-back'

export function useBonusBackOffers() {
  const [offers, setOffers] = useState<BonusBackOffer[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/bonus-back', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Promotion confirmations unavailable')
      const data = await response.json()
      if (!Array.isArray(data.offers) || !data.offers.every(isBonusBackOffer)) throw new Error('Invalid promotion confirmations')
      if (!controller.signal.aborted) { setOffers(data.offers); setCanEdit(data.canEdit === true); setState('ready') }
    }).catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [])
  return { offers, setOffers, canEdit, state }
}

interface PromotionRace {
  id: string
  label: string
  runners: Array<{ id: string; name: string; win?: number; topThree?: number }>
}

const BonusBackOffersContext = createContext<BonusBackOffer[] | undefined>(undefined)

export function BonusBackPromotionBadge({ raceId }: { raceId: string }) {
  const offers = useContext(BonusBackOffersContext)
  const offer = offers?.find(item => item.raceId === raceId)
  if (!offer) return null

  return <span role="note" title="Manually confirmed TAB Bonus Back offer; eligibility and redemption terms apply." className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800">
    <BadgePercent size={14} aria-hidden="true" />
    TAB Bonus Back · {offer.runnerName} · 2nd/3rd: bonus bet up to ${offer.cap.toFixed(2)}
  </span>
}

export function BonusBackPromotions({ races, children }: { races: PromotionRace[]; children: ReactNode }) {
  const { offers, setOffers, canEdit, state } = useBonusBackOffers()
  const [raceId, setRaceId] = useState('')
  const [runnerId, setRunnerId] = useState('')
  const [cap, setCap] = useState(50)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const selected = races.find(race => race.id === raceId)

  async function save() {
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch('/api/bonus-back', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raceId, runnerId, cap, confirmed }) })
      const data = await response.json()
      if (!response.ok || !isBonusBackOffer(data.offer)) throw new Error(data.message ?? 'Confirmation failed')
      setOffers(previous => [...previous, data.offer])
      setConfirmed(false)
      setMessage('Promotion confirmation saved.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Confirmation failed') }
    finally { setSaving(false) }
  }

  return <>
    <BonusBackOffersContext.Provider value={offers}>{children}</BonusBackOffersContext.Provider>
    {canEdit && <details className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">Manage TAB Bonus Back confirmations</summary>
      <div className="mt-3">
        <p className="text-xs text-slate-600">Manually confirmed selected WIN bets only. Second or third earns a bonus bet up to the confirmed cap, not cash. Eligibility, expiry and redemption terms apply.</p>
        {state === 'loading' ? <p role="status" className="mt-2 text-sm">Loading confirmations...</p> : state === 'error' ? <p role="status" className="mt-2 text-sm text-amber-800">Promotion confirmations unavailable. No bonus assumed.</p> : <>
          <ul className="mt-3 divide-y divide-slate-200">{offers.filter(offer => races.some(race => race.id === offer.raceId)).map(offer => {
            const race = races.find(race => race.id === offer.raceId)!
            const runner = race.runners.find(runner => runner.id === offer.runnerId)
            const chance = bonusBackProbability(runner?.win, runner?.topThree)
            return <li key={offer.raceId} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span className="font-semibold">{race.label} · {offer.runnerName}</span><span>2nd/3rd: bonus up to ${offer.cap.toFixed(2)}{chance == null ? '' : ` · Model chance ${(chance * 100).toFixed(1)}%`}</span></li>
          })}</ul>
          {!offers.some(offer => races.some(race => race.id === offer.raceId)) && <p className="mt-2 text-sm text-slate-500">No upcoming promotion confirmations.</p>}
        </>}
        <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); void save() }}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs">Race<select className="max-w-full rounded border p-2 text-sm" value={raceId} onChange={event => { setRaceId(event.target.value); setRunnerId(''); setConfirmed(false) }} required disabled={saving}><option value="">Select race</option>{races.filter(race => !offers.some(offer => offer.raceId === race.id)).map(race => <option key={race.id} value={race.id}>{race.label}</option>)}</select></label>
            <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs">Eligible WIN runner<select className="max-w-full rounded border p-2 text-sm" value={runnerId} onChange={event => { setRunnerId(event.target.value); setConfirmed(false) }} required disabled={!selected || saving}><option value="">Select runner</option>{selected?.runners.map(runner => <option key={runner.id} value={runner.id}>{runner.name}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs">Bonus cap ($)<input className="w-24 rounded border p-2 text-sm" type="number" min="0.01" max="50" step="0.01" value={cap} onChange={event => setCap(Number(event.target.value))} required disabled={saving} /></label>
            <button type="submit" disabled={saving || !confirmed || !runnerId} className="flex items-center gap-2 rounded bg-teal-700 px-3 py-2 text-sm text-white disabled:opacity-50"><Check size={16} />{saving ? 'Saving...' : 'Confirm offer'}</button>
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required disabled={saving} />I verified TAB eligibility, opt-in, price/stake limits and expiry for this selected WIN bet. One qualifying paper bet per account/race; confirmation cannot be backdated.</label>
          {message && <p role="status" className="text-sm">{message}</p>}
        </form>
      </div>
    </details>}
  </>
}
