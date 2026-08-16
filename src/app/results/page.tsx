import { Suspense } from 'react'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'

const PAGE_SIZE = 50

async function loadRecentRaces() {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data: racecourses, error: racecoursesError } = await supabase
    .from('racecourses')
    .select('id, name')

  if (racecoursesError) throw racecoursesError

  const courseNames = new Map((racecourses ?? []).map((rc) => [rc.id, rc.name]))

  const { data: races, error } = await supabase
    .from('races')
    .select('id, racecourse_id, race_datetime, distance_m, track_condition, race_class, status')
    .eq('status', 'completed')
    .gte('race_datetime', cutoff)
    .order('race_datetime', { ascending: false })
    .limit(PAGE_SIZE)

  if (error) throw error

  const raceIds = (races ?? []).map((race) => race.id)

  const { data: entries } = await supabase
    .from('race_entries')
    .select('race_id, horse_id, finishing_position, finishing_time, margin, barrier_number, weight_carried, jockey, trainer, status, horses(name)')
    .in('race_id', raceIds)

  const { data: predictions } = await supabase
    .from('predictions')
    .select('race_id, predictions, confidence_scores, predicted_at')
    .in('race_id', raceIds)
    .order('predicted_at', { ascending: false })

  const entriesByRace = new Map<string, any[]>()
  for (const entry of entries ?? []) {
    const existing = entriesByRace.get(entry.race_id) ?? []
    existing.push(entry)
    entriesByRace.set(entry.race_id, existing)
  }

  const predictionsByRace = new Map<string, any>()
  for (const prediction of predictions ?? []) {
    predictionsByRace.set(prediction.race_id, prediction)
  }

  return {
    races: (races ?? []).map((race) => ({
      ...race,
      racecourseName: courseNames.get(race.racecourse_id) ?? race.racecourse_id,
    })),
    entriesByRace,
    predictionsByRace,
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normaliseVictorian(name: string) {
  const value = name.trim()
  if (!value) return name
  const prefixes = ['ladbrokes ', 'betdeluxe ', 'sportsbet-', 'sportsbet ', 'tab ', 'br', 'b/']
  const suffixes = [' synthetic', ' races', ' racecourse', ' rc']
  let cleaned = value.toLowerCase()
  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix)) cleaned = cleaned.slice(prefix.length)
  }
  for (const suffix of suffixes) {
    if (cleaned.endsWith(suffix)) cleaned = cleaned.slice(0, -suffix.length)
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function isVictorian(name: string) {
  const victoriaCourses = [
    'Flemington',
    'Caulfield',
    'Moonee Valley',
    'Sandown',
    'Ballarat',
    'Bendigo',
    'Geelong',
    'Mornington',
    'Sale',
    'Cranbourne',
    'Pakenham',
    'Melton',
    'Healesville',
    'Traralgon',
    'Moe',
    'Wodonga',
    'Shepparton',
    'Mildura',
    'Wangaratta',
    'Ararat',
    'Echuca',
    'Swan Hill',
    'Horsham',
    'Casterton',
    'Portland',
  ]
  const normalised = normaliseVictorian(name)
  return victoriaCourses.some((course) => normalised.toLowerCase().includes(course.toLowerCase()))
}

function PredictionBadge({ prediction }: { prediction: any }) {
  if (!prediction) return null

  const podium = prediction.predictions?.podium ?? prediction.predictions?.all_horses?.slice(0, 3) ?? []
  if (!podium.length) return null

  const confidence = prediction.confidence_scores?.winner ?? podium[0]?.win_probability ?? null

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="text-xs font-semibold text-zinc-400 mb-2">Prediction</div>
      <div className="space-y-1">
        {podium.map((horse: any, index: number) => (
          <div key={horse.horse_id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-300">
                {index + 1}
              </span>
              <span className="text-zinc-200">{horse.horse_name}</span>
            </div>
            {typeof horse.win_probability === 'number' ? (
              <span className="text-xs text-zinc-400">{(horse.win_probability * 100).toFixed(1)}%</span>
            ) : null}
          </div>
        ))}
      </div>
      {typeof confidence === 'number' ? (
        <div className="mt-2 text-xs text-zinc-500">Confidence: {(confidence * 100).toFixed(1)}%</div>
      ) : null}
    </div>
  )
}

function ActualResult({ entries }: { entries: any[] }) {
  if (!entries?.length) return null

  const finished = entries
    .filter((entry) => entry.status !== 'scratched' && entry.finishing_position != null)
    .sort((left, right) => left.finishing_position - right.finishing_position)

  if (!finished.length) return null

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="text-xs font-semibold text-zinc-400 mb-2">Actual Result</div>
      <div className="space-y-1">
        {finished.slice(0, 3).map((entry) => {
          const horseName = entry.horses?.name ?? 'Unknown'
          return (
            <div key={entry.horse_id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-zinc-300">
                  {entry.finishing_position}
                </span>
                <span className="text-zinc-200">{horseName}</span>
              </div>
              {typeof entry.finishing_time === 'number' ? (
                <span className="text-xs text-zinc-400">{entry.finishing_time.toFixed(2)}s</span>
              ) : null}
            </div>
          )
        })}
      </div>
      {finished[0]?.margin ? (
        <div className="mt-2 text-xs text-zinc-500">Winning margin: {finished[0].margin.toFixed(2)}s</div>
      ) : null}
    </div>
  )
}

function RaceCard({ race }: { race: any }) {
  const entries = race.entries ?? []
  const prediction = race.prediction
  const victorian = isVictorian(race.racecourseName)

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-100">{race.racecourseName}</h2>
            {victorian ? (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">Victoria</span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {formatTime(race.race_datetime)} · {race.distance_m ? `${race.distance_m}m` : null} · {race.track_condition ?? '—'} · {race.race_class ?? '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">{entries.length} runners</div>
          {prediction?.predicted_at ? (
            <div className="text-xs text-zinc-600">Predicted {new Date(prediction.predicted_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit' })}</div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <PredictionBadge prediction={prediction} />
        <ActualResult entries={entries} />
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'

export default function RecentResultsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Last 48 Hours</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Completed races with predictions vs actual results. Victoria races are highlighted.
          </p>
        </div>
        <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">Home</Link>
      </div>

      <Suspense fallback={<div className="text-sm text-zinc-500">Loading races...</div>}>
        <RaceResults />
      </Suspense>
    </div>
  )
}

async function RaceResults() {
  const { races, entriesByRace, predictionsByRace } = await loadRecentRaces()

  const mapped = races.map((race) => ({
    race,
    entries: entriesByRace.get(race.id) ?? [],
    prediction: predictionsByRace.get(race.id),
  }))

  const victoria = mapped.filter((item) => isVictorian(item.race.racecourseName))
  const other = mapped.filter((item) => !isVictorian(item.race.racecourseName))

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-200">Victoria</h2>
        <div className="space-y-3">
          {victoria.length ? (
            victoria.map((item) => <RaceCard key={item.race.id} race={item} />)
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
              No Victoria races in the last 48 hours.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-zinc-200">Other</h2>
        <div className="space-y-3">
          {other.length ? (
            other.map((item) => <RaceCard key={item.race.id} race={item} />)
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
              No other races in the last 48 hours.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
