import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { PredictionPayload } from '@/lib/types'
import { SiteNav } from '@/components/site-nav'

const PAGE_SIZE = 50

interface ResultEntry {
  race_id: string
  horse_id: string
  finishing_position: number | null
  finishing_time: number | null
  margin: number | null
  barrier_number: number | null
  weight_carried: number | null
  jockey: string | null
  trainer: string | null
  status: string
  horses: unknown
}

interface ResultPrediction {
  race_id: string
  predictions: PredictionPayload
  confidence_scores: { winner?: number }
  predicted_at: string
}

interface ResultRace {
  id: string
  racecourse_id: string
  race_datetime: string
  distance_m: number | null
  track_condition: string | null
  race_class: string | null
  status: string
  racecourseName: string
  entries: ResultEntry[]
  prediction?: ResultPrediction
}

function relatedName(value: unknown) {
  const relation = Array.isArray(value) ? value[0] : value
  if (!relation || typeof relation !== 'object' || !('name' in relation)) return 'Unknown'
  return typeof relation.name === 'string' ? relation.name : 'Unknown'
}

async function loadRecentRaces() {
  const supabase = await createClient()
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

  const { data: entries, error: entriesError } = await supabase
    .from('race_entries')
    .select('race_id, horse_id, finishing_position, finishing_time, margin, barrier_number, weight_carried, jockey, trainer, status, horses(name)')
    .in('race_id', raceIds)

  const { data: predictions, error: predictionsError } = await supabase
    .from('predictions')
    .select('race_id, predictions, confidence_scores, predicted_at')
    .in('race_id', raceIds)
    .order('predicted_at', { ascending: false })

  if (entriesError) throw entriesError
  if (predictionsError) throw predictionsError

  const entriesByRace = new Map<string, ResultEntry[]>()
  for (const entry of (entries ?? []) as ResultEntry[]) {
    const existing = entriesByRace.get(entry.race_id) ?? []
    existing.push(entry)
    entriesByRace.set(entry.race_id, existing)
  }

  const predictionsByRace = new Map<string, ResultPrediction>()
  for (const prediction of (predictions ?? []) as ResultPrediction[]) {
    if (!predictionsByRace.has(prediction.race_id)) predictionsByRace.set(prediction.race_id, prediction)
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

function PredictionBadge({ prediction }: { prediction?: ResultPrediction }) {
  if (!prediction) return null

  const podium = prediction.predictions?.podium ?? prediction.predictions?.all_horses?.slice(0, 3) ?? []
  if (!podium.length) return null

  const confidence = prediction.confidence_scores?.winner ?? podium[0]?.win_probability ?? null

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
      <div className="mb-3 text-xs font-bold uppercase text-teal-800">Prediction</div>
      <div className="space-y-1">
        {podium.map((horse, index) => (
          <div key={horse.horse_id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">
                {index + 1}
              </span>
              <span className="font-medium text-slate-900">{horse.horse_name}</span>
            </div>
            {typeof horse.win_probability === 'number' ? (
              <span className="text-xs font-semibold text-teal-800">{(horse.win_probability * 100).toFixed(1)}%</span>
            ) : null}
          </div>
        ))}
      </div>
      {typeof confidence === 'number' ? (
        <div className="mt-3 border-t border-teal-200 pt-2 text-xs text-teal-800">Confidence: {(confidence * 100).toFixed(1)}%</div>
      ) : null}
    </div>
  )
}

function ActualResult({ entries }: { entries: ResultEntry[] }) {
  if (!entries?.length) return null

  const hasPosition = (entry: ResultEntry): entry is ResultEntry & { finishing_position: number } =>
    entry.finishing_position !== null
  const finished = entries
    .filter((entry) => entry.status !== 'scratched')
    .filter(hasPosition)
    .sort((left, right) => left.finishing_position - right.finishing_position)

  if (!finished.length) return null

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="mb-3 text-xs font-bold uppercase text-emerald-800">Actual Result</div>
      <div className="space-y-1">
        {finished.slice(0, 3).map((entry) => {
          const horseName = relatedName(entry.horses)
          return (
            <div key={entry.horse_id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                  {entry.finishing_position}
                </span>
                <span className="font-medium text-slate-900">{horseName}</span>
              </div>
              {typeof entry.finishing_time === 'number' ? (
                <span className="text-xs font-semibold text-emerald-800">{entry.finishing_time.toFixed(2)}s</span>
              ) : null}
            </div>
          )
        })}
      </div>
      {finished[0]?.margin ? (
        <div className="mt-3 border-t border-emerald-200 pt-2 text-xs text-emerald-800">Winning margin: {finished[0].margin.toFixed(2)}s</div>
      ) : null}
    </div>
  )
}

function RaceCard({ race }: { race: ResultRace }) {
  const entries = race.entries
  const prediction = race.prediction
  const victorian = isVictorian(race.racecourseName)

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{race.racecourseName}</h2>
            {victorian ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Victoria</span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {formatTime(race.race_datetime)} · {race.distance_m ? `${race.distance_m}m` : null} · {race.track_condition ?? '—'} · {race.race_class ?? '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium text-slate-600">{entries.length} runners</div>
          {prediction?.predicted_at ? (
            <div className="text-xs text-slate-500">Predicted {new Date(prediction.predicted_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit' })}</div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <PredictionBadge prediction={prediction} />
        <ActualResult entries={entries} />
      </div>
    </article>
  )
}

export const dynamic = 'force-dynamic'

export default function RecentResultsPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Last 48 Hours</h1>
          <p className="mt-1 text-sm text-slate-600">
            Completed races with predictions vs actual results. Victoria races are highlighted.
          </p>
        </div>
        <SiteNav />
      </div>

      <Suspense fallback={<div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading races...</div>}>
        <RaceResults />
      </Suspense>
      </div>
    </div>
  )
}

async function RaceResults() {
  const { races, entriesByRace, predictionsByRace } = await loadRecentRaces()

  const mapped: ResultRace[] = races.map((race) => ({
    ...race,
    entries: entriesByRace.get(race.id) ?? [],
    prediction: predictionsByRace.get(race.id),
  }))

  const victoria = mapped.filter((race) => isVictorian(race.racecourseName))
  const other = mapped.filter((race) => !isVictorian(race.racecourseName))

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">Victoria</h2>
        <div className="space-y-3">
          {victoria.length ? (
            victoria.map((race) => <RaceCard key={race.id} race={race} />)
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
              No Victoria races in the last 48 hours.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">Other</h2>
        <div className="space-y-3">
          {other.length ? (
            other.map((race) => <RaceCard key={race.id} race={race} />)
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
              No other races in the last 48 hours.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
