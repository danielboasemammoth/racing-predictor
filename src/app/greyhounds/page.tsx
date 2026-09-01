import { createClient } from '@/lib/supabase/server'
import { SiteNav } from '@/components/site-nav'
import { queryLatestOpportunities, type OpportunityRow } from '@/lib/paper-betting/opportunities-query'
import { PaperBetButton } from './paper-bet-button'

const DECISION_STYLES: Record<string, string> = {
  BET: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  WATCH: 'bg-amber-50 text-amber-800 border-amber-200',
}

function runnerOf(row: OpportunityRow) {
  return Array.isArray(row.pe_runners) ? row.pe_runners[0] : row.pe_runners
}

function raceOf(row: OpportunityRow) {
  return Array.isArray(row.pe_races) ? row.pe_races[0] : row.pe_races
}

async function loadUpcomingGreyhoundOpportunities() {
  const supabase = await createClient()
  const opportunities = await queryLatestOpportunities(supabase, { category: 'greyhound' })

  const byRace = new Map<string, { venue: string; raceNumber: number; startTime: string; rows: OpportunityRow[] }>()
  for (const row of opportunities) {
    const race = raceOf(row)
    if (!race) continue
    const existing = byRace.get(row.race_id)
    if (existing) existing.rows.push(row)
    else byRace.set(row.race_id, { venue: race.venue, raceNumber: race.race_number, startTime: race.start_time, rows: [row] })
  }

  return [...byRace.entries()]
    .map(([raceId, group]) => ({ raceId, ...group, rows: group.rows.sort((a, b) => (b.edge_points ?? 0) - (a.edge_points ?? 0)) }))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
}

export default async function GreyhoundsPage() {
  const raceGroups = await loadUpcomingGreyhoundOpportunities()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold text-slate-900">Greyhounds</h1>
          <SiteNav />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <p className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-700">
          Greyhound recommendations currently use a cross-bookmaker market-consensus baseline model
          (comparing TAB against the wider market), not a dedicated greyhound fundamentals model -
          see the project report for details and next steps.
        </p>

        {raceGroups.length === 0 && (
          <p className="text-sm text-slate-600">
            No upcoming greyhound races with recommendations yet - run &ldquo;Sync PuntersEdge Odds &amp;
            Recommendations&rdquo; from the Admin page.
          </p>
        )}

        {raceGroups.map((group) => (
          <section key={group.raceId} className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              {group.venue} R{group.raceNumber} · {new Date(group.startTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </h2>
            <ul className="space-y-2">
              {group.rows.map((rec) => {
                const runner = runnerOf(rec)
                if (!runner || rec.tab_win_price == null || rec.model_probability == null) return null
                return (
                  <li key={rec.id} className={`flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm ${DECISION_STYLES[rec.decision]}`}>
                    <span className="font-medium">
                      #{runner.runner_number} {runner.name}
                    </span>
                    <span className="flex flex-wrap items-center gap-4 text-xs">
                      <span>TAB ${rec.tab_win_price.toFixed(2)}</span>
                      <span>Edge {rec.edge_points != null ? `${rec.edge_points >= 0 ? '+' : ''}${rec.edge_points.toFixed(1)}pts` : 'n/a'}</span>
                      <span>{rec.confidence_level}</span>
                      <span className="font-semibold">{rec.decision}</span>
                    </span>
                    <PaperBetButton
                      raceId={rec.race_id}
                      runnerId={rec.runner_id}
                      runnerName={runner.name}
                      category="greyhound"
                      tabWinPrice={rec.tab_win_price}
                      tabPlacePrice={rec.tab_place_price}
                      modelProbability={rec.model_probability}
                      modelVersion="market-consensus-v1"
                      edgePoints={rec.edge_points}
                      expectedValue={rec.expected_value}
                      confidenceLevel={rec.confidence_level}
                    />
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </main>
    </div>
  )
}

