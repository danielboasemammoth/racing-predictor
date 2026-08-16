import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { PredictedHorse } from '@/lib/types'

const PAGE_SIZE = 20

interface VerifyRace {
  id: string
  race_datetime: string
  distance_m: number | null
  track_condition: string | null
  race_class: string | null
  status: string
  racecourse: string
}

interface VerifyEntry {
  position: number | null
  horse: string
}

function relatedName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value
  if (!relation || typeof relation !== 'object' || !('name' in relation)) return 'Unknown'
  return typeof relation.name === 'string' ? relation.name : 'Unknown'
}

async function loadRaces(page: number) {
  const supabase = await createClient()
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

  if (countResult.error) throw countResult.error

  const races: VerifyRace[] = racesResult.data.map((race) => ({
    ...race,
    racecourse: relatedName(race.racecourses),
  }))

  return {
    races,
    total: countResult.count ?? 0,
    page,
    totalPages: Math.ceil((countResult.count ?? 0) / PAGE_SIZE),
  }
}

async function loadEntries(raceId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('race_entries')
    .select('finishing_position, horse_id, horses(id, name)')
    .eq('race_id', raceId)
    .order('finishing_position', { ascending: true })

  if (error) throw error
  return data.map((entry) => ({
    position: entry.finishing_position,
    horse: relatedName(entry.horses),
  }))
}

async function loadPredictions(raceId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('predictions')
    .select('predictions, predicted_at')
    .eq('race_id', raceId)
    .order('predicted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  const podium = (data?.predictions?.podium ?? []) as PredictedHorse[]
  return podium.map((horse) => ({
    position: horse.predicted_position,
    horse: horse.horse_name,
  }))
}

function buildRacingComUrl(racecourse: string, dateStr: string) {
  const slug = racecourse.toLowerCase().replace(/\s+/g, '-')
  return `https://www.racing.com/form/${dateStr}/${slug}`
}

export const dynamic = 'force-dynamic'

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams
  const requestedPage = Math.max(1, Math.floor(Number(pageParam) || 1))
  const initial = await loadRaces(requestedPage)
  const page = Math.min(requestedPage, Math.max(initial.totalPages, 1))
  const { races, total, totalPages } = page === requestedPage ? initial : await loadRaces(page)

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Race Data Verification</h1>
          <p className="mt-1 text-sm text-slate-600">
            Cross-check our data against live Racing.com results. {total} races in database.
          </p>
        </div>
        <Link href="/" className="text-sm font-semibold text-teal-700 hover:text-teal-900">Back to races</Link>
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
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              ← Previous
            </a>
          )}
          <span className="text-sm font-medium text-slate-600">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={`/verify?page=${page + 1}`}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Next →
            </a>
          )}
        </div>
      )}
      </div>
    </div>
  )
}

async function RaceCard({ race }: { race: VerifyRace }) {
  const [entries, predictions] = await Promise.all([
    loadEntries(race.id),
    loadPredictions(race.id),
  ])

  const dateStr = new Date(race.race_datetime).toISOString().split('T')[0]
  const racingComUrl = buildRacingComUrl(race.racecourse, dateStr)
  const hasResults = entries.some((e) => e.position)
  const hasPredictions = predictions.length > 0

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {race.racecourse} — {new Date(race.race_datetime).toLocaleString('en-AU')}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-slate-700">
            {race.distance_m && <span className="rounded bg-slate-100 px-2 py-1">{race.distance_m}m</span>}
            {race.track_condition && <span className="rounded bg-slate-100 px-2 py-1">{race.track_condition}</span>}
            {race.race_class && <span className="rounded bg-slate-100 px-2 py-1">{race.race_class}</span>}
            <span className={`rounded px-2 py-1 font-semibold ${race.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
              {race.status}
            </span>
          </div>
        </div>
        <a
          href={racingComUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-teal-700 bg-white px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-50"
        >
          View on Racing.com ↗
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
          <h3 className="mb-3 text-xs font-bold uppercase text-teal-800">Our Predictions</h3>
          {hasPredictions ? (
            <ol className="space-y-1">
              {predictions.map((pred) => (
                <li key={pred.position} className="flex items-center gap-2 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">
                    {pred.position}
                  </span>
                  <span className="font-medium text-slate-900">{pred.horse}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-600">No predictions yet</p>
          )}
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <h3 className="mb-3 text-xs font-bold uppercase text-emerald-800">Actual Results</h3>
          {hasResults ? (
            <ol className="space-y-1">
              {entries
                .filter((e) => e.position)
                .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                .map((entry) => (
                  <li key={entry.position} className="flex items-center gap-2 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                      {entry.position}
                    </span>
                    <span className="font-medium text-slate-900">{entry.horse}</span>
                  </li>
                ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-600">
              No results imported yet.{' '}
              {race.status === 'upcoming' && 'Race has not been run.'}
            </p>
          )}
        </div>
      </div>

      {hasPredictions && hasResults && (
        <AccuracyBadge predictions={predictions} entries={entries.filter((e) => e.position)} />
      )}
    </article>
  )
}

function AccuracyBadge({ predictions, entries }: { predictions: VerifyEntry[]; entries: VerifyEntry[] }) {
  const hasPosition = (entry: VerifyEntry): entry is VerifyEntry & { position: number } => entry.position !== null
  const predictedTop3 = predictions.filter(hasPosition).filter((p) => p.position <= 3).map((p) => p.horse)
  const actualTop3 = entries
    .filter(hasPosition)
    .filter((e) => e.position <= 3)
    .sort((a, b) => a.position - b.position)
    .map((e) => e.horse)

  const hits = predictedTop3.filter((horse) => actualTop3.includes(horse)).length
  const winnerHit = actualTop3[0] && predictedTop3[0] === actualTop3[0]

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {winnerHit && (
        <span className="rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-900">
          ✓ Winner predicted correctly
        </span>
      )}
      {!winnerHit && (
        <span className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800">
          ✗ Winner missed
        </span>
      )}
      <span className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
        Podium hits: {hits}/3
      </span>
    </div>
  )
}
