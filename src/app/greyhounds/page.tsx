import { createClient } from '@/lib/supabase/server'
import { SiteNav } from '@/components/site-nav'

interface RaceRow {
  id: string
  venue: string
  race_number: number
  start_time: string
  status: string
}

interface RecommendationRow {
  id: string
  race_id: string
  runner_id: string
  model_probability: number | null
  tab_win_price: number | null
  edge_points: number | null
  expected_value: number | null
  confidence_level: string | null
  decision: 'BET' | 'WATCH' | 'NO_BET'
  generated_at: string
  pe_runners: { name: string; runner_number: number } | { name: string; runner_number: number }[] | null
}

const DECISION_STYLES: Record<string, string> = {
  BET: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  WATCH: 'bg-amber-50 text-amber-800 border-amber-200',
}

function runnerOf(row: RecommendationRow) {
  return Array.isArray(row.pe_runners) ? row.pe_runners[0] : row.pe_runners
}

async function loadUpcomingGreyhoundRaces() {
  const supabase = await createClient()
  const races = await supabase
    .from('pe_races')
    .select('id, venue, race_number, start_time, status')
    .eq('category', 'greyhound')
    .eq('status', 'upcoming')
    .order('start_time', { ascending: true })
    .limit(30)
  if (races.error) throw races.error
  if (!races.data || races.data.length === 0) return []

  const raceIds = races.data.map((r) => r.id)
  const recentCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const recs = await supabase
    .from('pe_recommendations')
    .select('id, race_id, runner_id, model_probability, tab_win_price, edge_points, expected_value, confidence_level, decision, generated_at, pe_runners(name, runner_number)')
    .in('race_id', raceIds)
    .in('decision', ['BET', 'WATCH'])
    .gte('generated_at', recentCutoff)
    .order('generated_at', { ascending: false })
  if (recs.error) throw recs.error

  const seenRunner = new Set<string>()
  const latestPerRunner = (recs.data ?? []).filter((r) => {
    if (seenRunner.has(r.runner_id)) return false
    seenRunner.add(r.runner_id)
    return true
  }) as RecommendationRow[]

  return (races.data as RaceRow[]).map((race) => ({
    race,
    recommendations: latestPerRunner
      .filter((r) => r.race_id === race.id)
      .sort((a, b) => (b.edge_points ?? 0) - (a.edge_points ?? 0)),
  }))
}

export default async function GreyhoundsPage() {
  const raceGroups = await loadUpcomingGreyhoundRaces()

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

        {raceGroups.map(({ race, recommendations }) => (
          <section key={race.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              {race.venue} R{race.race_number} · {new Date(race.start_time).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </h2>
            {recommendations.length === 0 ? (
              <p className="text-sm text-slate-500">No qualifying opportunities in this race right now.</p>
            ) : (
              <ul className="space-y-2">
                {recommendations.map((rec) => {
                  const runner = runnerOf(rec)
                  return (
                    <li key={rec.id} className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${DECISION_STYLES[rec.decision]}`}>
                      <span className="font-medium">
                        #{runner?.runner_number} {runner?.name}
                      </span>
                      <span className="flex gap-4 text-xs">
                        <span>TAB ${rec.tab_win_price?.toFixed(2)}</span>
                        <span>Edge {rec.edge_points != null ? `${rec.edge_points >= 0 ? '+' : ''}${rec.edge_points.toFixed(1)}pts` : 'n/a'}</span>
                        <span>{rec.confidence_level}</span>
                        <span className="font-semibold">{rec.decision}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ))}
      </main>
    </div>
  )
}
