import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadReliabilityContext } from '@/lib/reliability-context'
import { loadDailyPicksHistory, type HistoricalDailyPick } from '@/lib/daily-picks-history'
import { SiteNav } from '@/components/site-nav'

export const dynamic = 'force-dynamic'

function formatDateHeading(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Australia/Sydney',
  })
}

function ResultBadge({ pick }: { pick: HistoricalDailyPick }) {
  if (pick.scratched) {
    return <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold uppercase text-slate-600">Scratched</span>
  }
  if (pick.actualPosition === null) {
    return <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold uppercase text-slate-600">No result yet</span>
  }
  if (pick.won) {
    return <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold uppercase text-white">Won</span>
  }
  if (pick.placedTop3) {
    return <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold uppercase text-white">Placed {pick.actualPosition}</span>
  }
  return <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold uppercase text-white">Finished {pick.actualPosition}</span>
}

function PickCard({ pick, rank }: { pick: HistoricalDailyPick; rank: number }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">Rank {rank}</p>
          <h3 className="mt-1 text-lg font-bold text-slate-900">{pick.horse.horse_name}</h3>
          <p className="mt-1 text-sm text-slate-600">{pick.race.racecourses?.name} · Race {pick.race.race_number}</p>
        </div>
        <ResultBadge pick={pick} />
      </div>

      {pick.reliability && (
        <p className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
          Reliability {pick.reliability.score}/100 · {pick.reliability.classification}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-3">
        <div>
          <dt className="text-xs text-slate-500">Predicted win probability</dt>
          <dd className="mt-0.5 text-xl font-bold text-slate-900">{(pick.winProbability * 100).toFixed(0)}%</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Predicted top-three probability</dt>
          <dd className="mt-0.5 text-xl font-bold text-teal-800">{(pick.top3Probability * 100).toFixed(0)}%</dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-slate-500">{formatDateTime(pick.race.race_datetime)}</p>
      <Link href={`/races/${pick.race.id}`} className="mt-3 inline-block text-sm font-semibold text-teal-700 hover:text-teal-900">
        Review race details →
      </Link>
    </article>
  )
}

export default async function PicksHistoryPage() {
  const supabase = await createClient()
  const reliabilityContext = await loadReliabilityContext(supabase)
  const history = await loadDailyPicksHistory(supabase, { calibration: reliabilityContext?.calibration ?? null, days: 21 })

  const scoredPicks = history.flatMap((day) => day.picks).filter((pick) => !pick.scratched && pick.actualPosition !== null)
  const wins = scoredPicks.filter((pick) => pick.won).length
  const top3s = scoredPicks.filter((pick) => pick.placedTop3).length
  const winRate = scoredPicks.length ? wins / scoredPicks.length : 0
  const top3Rate = scoredPicks.length ? top3s / scoredPicks.length : 0

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Past Picks</h1>
              <p className="text-sm text-slate-600 mt-1">How the daily conservative shortlist actually performed, once races are complete.</p>
            </div>
            <SiteNav />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {scoredPicks.length > 0 && (
          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Picks with a result</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{scoredPicks.length}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Win rate</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{(winRate * 100).toFixed(1)}%</p>
              <p className="text-xs text-slate-500">{wins} of {scoredPicks.length}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Top-three rate</p>
              <p className="mt-1 text-2xl font-bold text-teal-700">{(top3Rate * 100).toFixed(1)}%</p>
              <p className="text-xs text-slate-500">{top3s} of {scoredPicks.length}</p>
            </div>
          </div>
        )}

        {history.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-600">
            No completed races with predictions in the last 21 days yet.
          </div>
        ) : (
          history.map((day) => (
            <section key={day.dateKey}>
              <h2 className="text-lg font-semibold text-slate-900">{formatDateHeading(day.dateKey)}</h2>
              <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-3">
                {day.picks.map((pick, index) => (
                  <PickCard key={pick.race.id} pick={pick} rank={index + 1} />
                ))}
              </div>
            </section>
          ))
        )}

        <p className="text-xs text-slate-500">
          Reconstructed from completed races and their pre-race (retrospective) predictions using the same ranking as the live homepage shortlist,
          since the exact picks shown live each day aren&apos;t separately recorded. This can only differ from what was shown live if a race&apos;s
          runners changed after the live prediction was generated.
        </p>
      </main>
    </div>
  )
}
