import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Race, RaceWithPrediction, Prediction } from '@/lib/types'
import { getDailyPicks, getTomorrowPicks, type DailyPicksFilterOptions } from '@/lib/daily-picks'
import { CURRENT_MODEL_VERSIONS } from '@/lib/prediction-suite'
import { loadReliabilityContext } from '@/lib/reliability-context'

export const dynamic = 'force-dynamic'

function melbourneUtcOffsetMinutes(reference: Date) {
  const offsetName = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Melbourne',
    timeZoneName: 'longOffset',
  }).formatToParts(reference).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+10:00'
  const match = /GMT([+-]\d{2}):?(\d{2})?/.exec(offsetName)
  if (!match) return 600
  const hours = Number(match[1])
  const minutes = Number(match[2] ?? '0')
  return hours * 60 + (hours < 0 ? -minutes : minutes)
}

/** UTC instant of local midnight in Melbourne for the given YYYY-MM-DD date, accounting for daylight saving. */
function melbourneMidnightUtc(dateKey: string, reference: Date) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const offsetMinutes = melbourneUtcOffsetMinutes(reference)
  return new Date(Date.UTC(year, month - 1, day) - offsetMinutes * 60_000)
}

async function getUpcomingRaces(): Promise<RaceWithPrediction[]> {
  const supabase = await createClient()

  // National racing volume can exceed a simple row cap, so bound the window to "through tomorrow"
  // (Melbourne time) instead, with a high safety-net limit rather than an arbitrary small count.
  const now = new Date()
  const dayAfterTomorrow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)
  const dayAfterTomorrowKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dayAfterTomorrow)
  const endOfTomorrow = melbourneMidnightUtc(dayAfterTomorrowKey, now)

  const { data: races, error: racesError } = await supabase
    .from('races')
    .select('*, racecourses(*)')
    .eq('status', 'upcoming')
    .gte('race_datetime', now.toISOString())
    .lt('race_datetime', endOfTomorrow.toISOString())
    .order('race_datetime', { ascending: true })
    .limit(300)

  if (racesError) throw racesError

  const typedRaces = (races ?? []) as Race[]
  if (typedRaces.length === 0) return []

  const { data: predictions, error: predictionsError } = await supabase
    .from('predictions')
    .select('*')
    .in('race_id', typedRaces.map((race) => race.id))
    .order('predicted_at', { ascending: false })

  if (predictionsError) throw predictionsError

  const predictionMap = new Map<string, Prediction>()
  const modelsByRace = new Map<string, Prediction[]>()
  ;(predictions as Prediction[] | null)?.forEach((prediction) => {
    if (prediction.model_version.includes('retrospective')) return
    if (!CURRENT_MODEL_VERSIONS.includes(prediction.model_version)) return
    const models = modelsByRace.get(prediction.race_id) ?? []
    if (!models.some((model) => model.model_version === prediction.model_version)) models.push(prediction)
    modelsByRace.set(prediction.race_id, models)
  })

  for (const [raceId, models] of modelsByRace) {
    const primary = models.find((model) => model.model_version === 'v4.1-ensemble') ?? models.find((model) => model.model_version === 'v4-ensemble') ?? models[0]
    if (primary) predictionMap.set(raceId, primary)
  }

  return typedRaces.map((race) => ({
    ...race,
    prediction: predictionMap.get(race.id) || null,
    model_predictions: modelsByRace.get(race.id) ?? [],
  }))
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Australia/Sydney'
  })
}

function formatDistance(m: number) {
  if (m >= 1000) return `${m / 1000}km`
  return `${m}m`
}

function getConfidenceColor(conf: number) {
  if (conf >= 0.7) return 'text-green-700 bg-green-50'
  if (conf >= 0.5) return 'text-amber-700 bg-amber-50'
  return 'text-red-700 bg-red-50'
}

export default async function Home({ searchParams }: { searchParams: Promise<{ minReliability?: string; maidenOnly?: string }> }) {
  const params = await searchParams
  const filters: DailyPicksFilterOptions = {
    minReliability: params.minReliability ? Number(params.minReliability) : undefined,
    maidenOnly: params.maidenOnly === '1',
  }

  const supabase = await createClient()
  const [races, reliabilityContext] = await Promise.all([getUpcomingRaces(), loadReliabilityContext(supabase)])
  filters.calibration = reliabilityContext?.calibration ?? null

  const dailyPicks = getDailyPicks(races, new Date(), 3, filters)
  const tomorrowPicks = getTomorrowPicks(races, new Date(), 3, filters)

  function filterLink(overrides: Partial<{ minReliability?: string; maidenOnly?: string }>) {
    const next = new URLSearchParams()
    const merged = { ...params, ...overrides }
    if (merged.minReliability) next.set('minReliability', merged.minReliability)
    if (merged.maidenOnly) next.set('maidenOnly', merged.maidenOnly)
    const query = next.toString()
    return query ? `/?${query}` : '/'
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Racing Predictor</h1>
              <p className="text-sm text-slate-600 mt-1">Australian horse race predictions powered by historical data</p>
            </div>
            <div className="flex gap-3">
              <Link href="/accuracy" className="text-sm font-medium text-teal-700 hover:text-teal-800">Accuracy</Link>
              <Link href="/analytics" className="text-sm font-medium text-teal-700 hover:text-teal-800">Analytics</Link>
              <Link href="/results" className="text-sm font-medium text-teal-700 hover:text-teal-800">Results</Link>
              <Link href="/verify" className="text-sm font-medium text-teal-700 hover:text-teal-800">Verify</Link>
              <Link href="/admin" className="text-sm font-medium text-slate-600 hover:text-slate-900">Admin</Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {races.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <p className="text-slate-600 mb-2">No upcoming races with predictions yet.</p>
            <Link href="/admin" className="text-teal-700 font-medium hover:underline">Go to Admin to run prediction model</Link>
          </div>
        ) : (
          <div className="space-y-6">
            {reliabilityContext && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-slate-600">Filters:</span>
                <Link
                  href={filterLink({ minReliability: params.minReliability === '80' ? undefined : '80' })}
                  className={`rounded-full border px-3 py-1 font-medium ${params.minReliability === '80' ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  Reliability ≥ 80
                </Link>
                <Link
                  href={filterLink({ maidenOnly: params.maidenOnly === '1' ? undefined : '1' })}
                  className={`rounded-full border px-3 py-1 font-medium ${params.maidenOnly === '1' ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  Maiden races only
                </Link>
                {(params.minReliability || params.maidenOnly) && (
                  <Link href="/" className="text-slate-500 underline hover:text-slate-700">Clear filters</Link>
                )}
              </div>
            )}

            {dailyPicks.length > 0 && (
              <section aria-labelledby="daily-picks-title" className="border-y border-teal-200 bg-teal-50 px-4 py-6 sm:px-6">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                  <div>
                    <p className="text-xs font-bold uppercase text-teal-800">Daily conservative shortlist</p>
                    <h2 id="daily-picks-title" className="mt-1 text-xl font-bold text-slate-900">Today&apos;s highest-conviction picks</h2>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">
                      Ranked by win and top-three probability, separation from the next runner, and pre-race form depth. Payout is not considered.
                    </p>
                    {dailyPicks.length < 3 && (
                      <p className="mt-1 text-xs text-slate-500">Only {dailyPicks.length} eligible {dailyPicks.length === 1 ? 'race remains' : 'races remain'} today.</p>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">Relative model confidence, not a guarantee.</p>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {dailyPicks.map((pick, index) => (
                    <article key={pick.race.id} className="border border-teal-200 bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase text-teal-700">
                            {index === 0 ? 'Today · lowest risk' : `Today · rank ${index + 1}`}
                          </p>
                          <h3 className="mt-1 text-lg font-bold text-slate-900">{pick.horse.horse_name}</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {pick.race.racecourses?.name} · Race {pick.race.race_number}
                          </p>
                        </div>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm font-bold text-white">
                          {index + 1}
                        </span>
                      </div>

                      {pick.reliability && (
                        <p className="mt-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          Reliability {pick.reliability.score}/100 · {pick.reliability.classification}
                        </p>
                      )}

                      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-3">
                        <div>
                          <dt className="text-xs text-slate-500">Win probability</dt>
                          <dd className="mt-0.5 text-xl font-bold text-slate-900">{(pick.winProbability * 100).toFixed(0)}%</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-500">Top-three probability</dt>
                          <dd className="mt-0.5 text-xl font-bold text-teal-800">{(pick.top3Probability * 100).toFixed(0)}%</dd>
                        </div>
                      </dl>

                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        <p>{(pick.leadOverSecond * 100).toFixed(1)} percentage-point lead over the next runner</p>
                        <p>{pick.historyStarts > 0 ? `${pick.historyStarts} prior starts analysed` : 'Limited prior-race history available'}</p>
                        <p>{formatDateTime(pick.race.race_datetime)} · {formatDistance(pick.race.distance_m || 0)}</p>
                      </div>

                      <Link href={`/races/${pick.race.id}`} className="mt-4 inline-block text-sm font-semibold text-teal-700 hover:text-teal-900">
                        Review race details →
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {tomorrowPicks.length > 0 && (
              <details className="border border-slate-200 bg-white px-4 py-4 sm:px-6">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold uppercase text-slate-500">Daily conservative shortlist</p>
                      <h2 className="mt-1 text-lg font-bold text-slate-900">Tomorrow&apos;s highest-conviction picks</h2>
                    </div>
                    <span className="text-sm font-medium text-teal-700">Show ▾</span>
                  </div>
                </summary>

                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {tomorrowPicks.map((pick, index) => (
                    <article key={pick.race.id} className="border border-slate-200 bg-slate-50 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase text-slate-500">
                            {index === 0 ? 'Tomorrow · lowest risk' : `Tomorrow · rank ${index + 1}`}
                          </p>
                          <h3 className="mt-1 text-lg font-bold text-slate-900">{pick.horse.horse_name}</h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {pick.race.racecourses?.name} · Race {pick.race.race_number}
                          </p>
                        </div>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-600 text-sm font-bold text-white">
                          {index + 1}
                        </span>
                      </div>

                      {pick.reliability && (
                        <p className="mt-2 inline-block rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">
                          Reliability {pick.reliability.score}/100 · {pick.reliability.classification}
                        </p>
                      )}

                      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-slate-200 py-3">
                        <div>
                          <dt className="text-xs text-slate-500">Win probability</dt>
                          <dd className="mt-0.5 text-xl font-bold text-slate-900">{(pick.winProbability * 100).toFixed(0)}%</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-slate-500">Top-three probability</dt>
                          <dd className="mt-0.5 text-xl font-bold text-teal-800">{(pick.top3Probability * 100).toFixed(0)}%</dd>
                        </div>
                      </dl>

                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        <p>{(pick.leadOverSecond * 100).toFixed(1)} percentage-point lead over the next runner</p>
                        <p>{pick.historyStarts > 0 ? `${pick.historyStarts} prior starts analysed` : 'Limited prior-race history available'}</p>
                        <p>{formatDateTime(pick.race.race_datetime)} · {formatDistance(pick.race.distance_m || 0)}</p>
                      </div>

                      <Link href={`/races/${pick.race.id}`} className="mt-4 inline-block text-sm font-semibold text-teal-700 hover:text-teal-900">
                        Review race details →
                      </Link>
                    </article>
                  ))}
                </div>
              </details>
            )}

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Upcoming Races</h2>
              <span className="text-sm text-slate-600">{races.length} races</span>
            </div>

            {races.map((race) => (
              <div key={race.id} className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-lg font-semibold text-slate-900">{race.racecourses?.name}</h3>
                      <span className="text-sm text-slate-600">Race {race.race_number}</span>
                    </div>
                    <p className="text-sm text-slate-600">{race.race_name}</p>
                    <div className="flex gap-4 mt-2 text-xs text-slate-500">
                      <span>{formatDateTime(race.race_datetime)}</span>
                      <span>{formatDistance(race.distance_m || 0)}</span>
                      {race.track_condition && <span className="capitalize">{race.track_condition}</span>}
                      {race.weather_condition && <span className="capitalize">{race.weather_condition}</span>}
                    </div>
                  </div>
                  <Link href={`/races/${race.id}`} className="text-sm font-medium text-teal-700 hover:text-teal-800">
                    View details →
                  </Link>
                </div>

                {race.prediction ? (
                  <div className="border-t border-slate-100 pt-4">
                    {race.model_predictions && race.model_predictions.length > 1 && (
                      <div className="mb-4">
                        <p className="mb-2 text-xs font-bold uppercase text-slate-600">Model confidence comparison</p>
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                          {race.model_predictions
                            .sort((left, right) => left.model_version.localeCompare(right.model_version))
                            .map((model) => {
                              const winner = model.predictions.podium[0]
                              return (
                                <div key={model.model_version} className={`border px-3 py-2 ${model.model_version === 'v4.1-ensemble' ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
                                  <p className="truncate text-[11px] font-semibold text-slate-500" title={model.model_version}>{model.model_version.replace('v4-', '')}</p>
                                  <p className="mt-1 truncate text-xs font-bold text-slate-900">{winner?.horse_name ?? 'No pick'}</p>
                                  <p className="text-xs text-slate-600">{((model.confidence_scores.winner ?? 0) * 100).toFixed(1)}%</p>
                                  {(model.confidence_scores.winner ?? 0) >= 0.25 && (
                                    <p className="mt-1 text-[10px] font-bold uppercase text-emerald-700">Lower-risk band</p>
                                  )}
                                </div>
                              )
                            })}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-medium text-slate-600">PREDICTED PODIUM</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getConfidenceColor(race.prediction.confidence_scores?.overall || 0)}`}>
                        {Math.round((race.prediction.confidence_scores?.overall || 0) * 100)}% confidence
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {race.prediction.predictions.podium.map((horse, idx) => (
                        <div key={horse.horse_id} className={`rounded-lg p-4 ${idx === 0 ? 'bg-amber-50 border-2 border-amber-300' : 'bg-slate-50 border border-slate-200'}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${idx === 0 ? 'bg-amber-400 text-white' : 'bg-slate-300 text-slate-700'}`}>
                              {idx + 1}
                            </span>
                            <span className="font-semibold text-slate-900 text-sm">{horse.horse_name}</span>
                          </div>
                          {horse.predicted_time && (
                            <p className="text-xs text-slate-600 ml-8">
                              Predicted: {horse.predicted_time}s
                            </p>
                          )}
                          <div className="ml-8 space-y-1 text-xs text-slate-600">
                            <p>{((horse.win_probability ?? horse.confidence) * 100).toFixed(0)}% win</p>
                            {horse.top3_probability !== undefined && <p>{(horse.top3_probability * 100).toFixed(0)}% top 3</p>}
                            {horse.win_return_10 !== undefined && <p>${horse.win_return_10.toFixed(2)} return / $10 win</p>}
                            {horse.place_return_10 !== undefined && <p>${horse.place_return_10.toFixed(2)} return / $10 place</p>}
                            {horse.value_rating !== 'neutral' && (
                              <p className={horse.value_rating === 'strong' ? 'font-semibold text-emerald-700' : 'font-medium text-teal-700'}>
                                {horse.value_rating === 'strong' ? 'Strong model value' : 'Positive model value'}
                              </p>
                            )}
                          </div>
                        </div>
                      )) || (
                        <div className="col-span-3 text-sm text-slate-500">No podium predictions available</div>
                      )}
                    </div>

                    {race.prediction.predictions.trifecta && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
                        <p className="font-semibold text-slate-900">
                          Trifecta likelihood: <span className="capitalize">{race.prediction.predictions.trifecta.likelihood}</span>
                          {' '}({(race.prediction.predictions.trifecta.probability * 100).toFixed(1)}%)
                        </p>
                        <p className="mt-1">
                          {race.prediction.predictions.trifecta.horse_names.join(' → ')} · model-fair $10 return approximately ${race.prediction.predictions.trifecta.fair_return_10.toFixed(0)}
                        </p>
                        {race.prediction.predictions.trifecta.notable_value && (
                          <p className="mt-1 font-semibold text-emerald-700">Notable likelihood / return profile</p>
                        )}
                        <p className="mt-1 text-slate-500">Estimate only. Actual trifecta dividends depend on the pool.</p>
                      </div>
                    )}

                    {race.prediction.predictions.value_opportunities?.length ? (
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <p className="text-xs font-semibold uppercase text-slate-600">Value watch</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {race.prediction.predictions.value_opportunities.slice(0, 3).map((opportunity) => (
                            <span key={`${opportunity.horse_id}-${opportunity.market}`} className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
                              <strong>{opportunity.horse_name}</strong> · {opportunity.market} {(opportunity.probability * 100).toFixed(0)}% · ${opportunity.return_10.toFixed(2)} / $10
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {race.prediction.predictions?.all_horses && race.prediction.predictions.all_horses.length > 3 && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <p className="text-xs text-slate-600">
                          Full field: {race.prediction.predictions.all_horses.map((horse) => horse.horse_name).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border-t border-slate-100 pt-4 text-sm text-slate-500">
                    No predictions yet — run model from Admin
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
