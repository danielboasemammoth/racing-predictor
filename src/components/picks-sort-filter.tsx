'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { PICKS_FILTER_STEPS, PICKS_SORT_KEYS, type PicksSortKey } from '@/lib/daily-picks'

const SORT_LABELS: Record<PicksSortKey, string> = {
  winProbability: 'Win probability',
  top3Probability: 'Top-three probability',
  reliability: 'Reliability',
  startTime: 'Start time',
}

/** Sort/filter controls for the home page's conservative picks sections - updates ?sort=/?minPct= and lets the server component re-render with the new order/threshold. */
export function PicksSortFilter({ sort, minPct }: { sort: PicksSortKey; minPct: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    next.set(key, value)
    router.push(`${pathname}?${next.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <span className="font-semibold text-slate-600">Conservative picks:</span>
      <label className="flex items-center gap-1.5 font-medium text-slate-600">
        Sort by
        <select
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900"
        >
          {PICKS_SORT_KEYS.map((key) => (
            <option key={key} value={key}>{SORT_LABELS[key]}</option>
          ))}
        </select>
      </label>
      {sort !== 'startTime' && (
        <label className="flex items-center gap-1.5 font-medium text-slate-600">
          Filter
          <select
            value={minPct}
            onChange={(e) => updateParam('minPct', e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900"
          >
            {PICKS_FILTER_STEPS.map((pct) => (
              <option key={pct} value={pct}>{sort === 'reliability' ? `${pct} and up` : `${pct}% and up`}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
