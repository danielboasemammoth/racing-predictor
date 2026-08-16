import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Race, RaceWithPrediction, Prediction } from '@/lib/types'

export const dynamic = 'force-dynamic'

async function getUpcomingRaces(): Promise<RaceWithPrediction[]> {
  const supabase = await createClient()
  const { data: races, error: racesError } = await supabase
    .from('races')
    .select('*, racecourses(*)')
    .eq('status', 'upcoming')
    .gte('race_datetime', new Date().toISOString())
    .order('race_datetime', { ascending: true })
    .limit(20)

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
  ;(predictions as Prediction[] | null)?.forEach((prediction) => {
    const existing = predictionMap.get(prediction.race_id)
    if (!existing || new Date(prediction.predicted_at) > new Date(existing.predicted_at)) {
      predictionMap.set(prediction.race_id, prediction)
    }
  })

  return typedRaces.map((race) => ({
    ...race,
    prediction: predictionMap.get(race.id) || null
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

export default async function Home() {
  const races = await getUpcomingRaces()

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
              <Link href="/results" className="text-sm font-medium text-teal-700 hover:text-teal-800">Results</Link>
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
