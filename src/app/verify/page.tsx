import { Suspense } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'

const PAGE_SIZE = 20

async function loadRaces(page: number) {
  const supabase = createAdminClient()
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const [racesResult, countResult] = await Promise.all([
    supabase
      .from('races')
      .select('id, race_datetime, distance_m, track_condition, race_class, status, racecourses(id, name)')
      .order('race_datetime', { ascending: false })
      .range(from, to),
    supabase.from('races').select('*', { count: 'exact', head: true }),
  ])

  if (racesResult.error) throw racesResult.error

  const races = racesResult.data.map((race: any) => ({
    ...race,
    racecourse: (race.racecourses as any)?.name ?? 'Unknown',
  }))

  return {
    races,
    total: countResult.count ?? 0,
    page,
    totalPages: Math.ceil((countResult.count ?? 0) / PAGE_SIZE),
  }
}

async function loadEntries(raceId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('race_entries')
    .select('finishing_position, horse_id, horses(id, name)')
    .eq('race_id', raceId)
    .order('finishing_position', { ascending: true })

  if (error) throw error
  return data.map((entry) => ({
    position: entry.finishing_position,
    horse: (entry.horses as any)?.name ?? 'Unknown',
  }))
}

async function loadPredictions(raceId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('predictions')
    .select('predicted_position, horses(id, name)')
    .eq('race_id', raceId)
    .order('predicted_position', { ascending: true })

  if (error) throw error
  return data.map((pred) => ({
    position: pred.predicted_position,
    horse: (pred.horses as any)?.name ?? 'Unknown',
  }))
}

function buildRacingComUrl(racecourse: string, dateStr: string) {
  const slug = racecourse.toLowerCase().replace(/\s+/g, '-')
  return `https://www.racing.com/races/${slug}/${dateStr}`
}

export const dynamic = 'force-dynamic'

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams
  const page = Number(pageParam) || 1
  const { races, total, totalPages } = await loadRaces(page)

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Race Data Verification</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Cross-check our data against live Racing.com results. {total} races in database.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {races.map((race) => (
          <RaceCard key={race.id} race={race} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          {page > 1 && (
            <a
              href={`/verify?page=${page - 1}`}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              ← Previous
            </a>
          )}
          <span className="text-sm text-zinc-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={`/verify?page=${page + 1}`}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Next →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

async function RaceCard({ race }: { race: any }) {
  const [entries, predictions] = await Promise.all([
    loadEntries(race.id),
    loadPredictions(race.id),
  ])

  const dateStr = new Date(race.race_datetime).toISOString().split('T')[0]
  const racingComUrl = buildRacingComUrl(race.racecourse, dateStr)
  const hasResults = entries.some((e) => e.position)
  const hasPredictions = predictions.length > 0

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">
            {race.racecourse} — {new Date(race.race_datetime).toLocaleString('en-AU')}
          </h2>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-400">
            {race.distance_m && <span className="rounded bg-zinc-800 px-2 py-1">{race.distance_m}m</span>}
            {race.track_condition && <span className="rounded bg-zinc-800 px-2 py-1">{race.track_condition}</span>}
            {race.race_class && <span className="rounded bg-zinc-800 px-2 py-1">{race.race_class}</span>}
            <span className={`rounded px-2 py-1 ${race.status === 'completed' ? 'bg-emerald-900/30 text-emerald-300' : 'bg-blue-900/30 text-blue-300'}`}>
              {race.status}
            </span>
          </div>
        </div>
        <a
          href={racingComUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          View on Racing.com ↗
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-300">Our Predictions</h3>
          {hasPredictions ? (
            <ol className="space-y-1">
              {predictions.map((pred) => (
                <li key={pred.position} className="flex items-center gap-2 text-sm">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-900/40 text-xs font-semibold text-teal-300">
                    {pred.position}
                  </span>
                  <span className="text-zinc-300">{pred.horse}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-500">No predictions yet</p>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-zinc-300">Actual Results</h3>
          {hasResults ? (
            <ol className="space-y-1">
              {entries
                .filter((e) => e.position)
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .map((entry) => (
                  <li key={entry.position} className="flex items-center gap-2 text-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-900/40 text-xs font-semibold text-emerald-300">
                      {entry.position}
                    </span>
                    <span className="text-zinc-300">{entry.horse}</span>
                  </li>
                ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-500">
              No results imported yet.{' '}
              {race.status === 'upcoming' && 'Race has not been run.'}
            </p>
          )}
        </div>
      </div>

      {hasPredictions && hasResults && (
        <AccuracyBadge predictions={predictions} entries={entries.filter((e) => e.position)} />
      )}
    </div>
  )
}

function AccuracyBadge({ predictions, entries }: { predictions: any[]; entries: any[] }) {
  const predictedTop3 = predictions.filter((p) => p.position <= 3).map((p) => p.horse)
  const actualTop3 = entries
    .filter((e) => e.position <= 3)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((e) => e.horse)

  const hits = predictedTop3.filter((horse) => actualTop3.includes(horse)).length
  const winnerHit = actualTop3[0] && predictedTop3[0] === actualTop3[0]

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {winnerHit && (
        <span className="rounded-lg border border-emerald-800 bg-emerald-900/20 px-3 py-1.5 text-xs font-medium text-emerald-300">
          ✓ Winner predicted correctly
        </span>
      )}
      {!winnerHit && (
        <span className="rounded-lg border border-red-900 bg-red-900/20 px-3 py-1.5 text-xs font-medium text-red-300">
          ✗ Winner missed
        </span>
      )}
      <span className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400">
        Podium hits: {hits}/3
      </span>
    </div>
  )
}
