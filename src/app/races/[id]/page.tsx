import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { RaceWithPrediction } from '@/lib/types'

async function getRaceData(raceId: string) {
  const { data: race } = await supabase
    .from('races')
    .select('*, racecourses(*)')
    .eq('id', raceId)
    .single()

  if (!race) return null

  const { data: entries } = await supabase
    .from('race_entries')
    .select('*, horses(*)')
    .eq('race_id', raceId)
    .order('barrier_number', { ascending: true })

  const { data: predictions } = await supabase
    .from('predictions')
    .select('*')
    .eq('race_id', raceId)
    .order('predicted_at', { ascending: false })
    .limit(1)
    .single()

  return { race, entries: entries || [], prediction: predictions || null }
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

function getStatusColor(status: string) {
  switch (status) {
    case 'upcoming': return 'bg-blue-100 text-blue-800'
    case 'live': return 'bg-green-100 text-green-800'
    case 'completed': return 'bg-slate-100 text-slate-800'
    case 'cancelled': return 'bg-red-100 text-red-800'
    default: return 'bg-slate-100 text-slate-800'
  }
}

export default async function RaceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getRaceData(id)

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <p className="text-slate-600">Race not found.</p>
          <Link href="/" className="text-teal-700 font-medium hover:underline">← Back to home</Link>
        </div>
      </div>
    )
  }

  const { race, entries, prediction } = data

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Link href="/" className="text-sm text-slate-600 hover:text-teal-700 mb-2 inline-block">← Back to races</Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{race.racecourses?.name}</h1>
              <p className="text-sm text-slate-600 mt-1">Race {race.race_number} — {race.race_name}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(race.status)}`}>
              {race.status}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Race details */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Date/Time</span>
              <p className="font-medium text-slate-900 mt-1">{formatDateTime(race.race_datetime)}</p>
            </div>
            <div>
              <span className="text-slate-500">Distance</span>
              <p className="font-medium text-slate-900 mt-1">{race.distance_m ? `${race.distance_m}m` : '—'}</p>
            </div>
            <div>
              <span className="text-slate-500">Track</span>
              <p className="font-medium text-slate-900 mt-1 capitalize">{race.track_condition || '—'}</p>
            </div>
            <div>
              <span className="text-slate-500">Weather</span>
              <p className="font-medium text-slate-900 mt-1 capitalize">{race.weather_condition || '—'}</p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Entries table */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Field</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 text-slate-600 font-medium">#</th>
                    <th className="text-left py-2 text-slate-600 font-medium">Horse</th>
                    <th className="text-left py-2 text-slate-600 font-medium">Jockey</th>
                    <th className="text-left py-2 text-slate-600 font-medium">Barrier</th>
                    <th className="text-left py-2 text-slate-600 font-medium">Weight</th>
                    <th className="text-left py-2 text-slate-600 font-medium">Result</th>
                    <th className="text-left py-2 text-slate-600 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-100">
                      <td className="py-3 text-slate-900 font-medium">{entry.barrier_number || '—'}</td>
                      <td className="py-3 text-slate-900 font-medium">{entry.horses?.name || '—'}</td>
                      <td className="py-3 text-slate-600">{entry.jockey || '—'}</td>
                      <td className="py-3 text-slate-600">{entry.barrier_number || '—'}</td>
                      <td className="py-3 text-slate-600">{entry.weight_carried ? `${entry.weight_carried}kg` : '—'}</td>
                      <td className="py-3">
                        {entry.finishing_position ? (
                          <span className="font-medium text-slate-900">{entry.finishing_position}{entry.finishing_position === 1 ? 'st' : entry.finishing_position === 2 ? 'nd' : entry.finishing_position === 3 ? 'rd' : 'th'}</span>
                        ) : (
                          <span className="text-slate-400">{entry.status}</span>
                        )}
                      </td>
                      <td className="py-3 text-slate-600">{entry.finishing_time ? `${entry.finishing_time}s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Prediction panel */}
          <div className="lg:col-span-1">
            {prediction ? (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Prediction</h2>
                <div className="text-xs text-slate-600 mb-3">Model: {prediction.model_version}</div>

                <div className="space-y-3 mb-4">
                  {prediction.predictions?.podium?.map((horse: any, idx: number) => (
                    <div key={horse.horse_id} className={`rounded-lg p-3 ${idx === 0 ? 'bg-amber-50 border-2 border-amber-300' : 'bg-slate-50 border border-slate-200'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${idx === 0 ? 'bg-amber-400 text-white' : 'bg-slate-300 text-slate-700'}`}>
                          {idx + 1}
                        </span>
                        <span className="font-semibold text-slate-900 text-sm">{horse.horse_name}</span>
                      </div>
                      {horse.predicted_time && (
                        <p className="text-xs text-slate-600 ml-7">Predicted: {horse.predicted_time}s</p>
                      )}
                      {horse.confidence && (
                        <p className="text-xs text-slate-500 ml-7">{(horse.confidence * 100).toFixed(0)}%</p>
                      )}
                    </div>
                  ))}
                </div>

                {prediction.actual_results && (
                  <div className="border-t border-slate-100 pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-slate-900 mb-2">Actual vs Predicted</h3>
                    <div className="text-xs text-slate-600">
                      Accuracy: {prediction.accuracy_score ? `${(prediction.accuracy_score * 100).toFixed(0)}%` : 'Pending'}
                    </div>
                  </div>
                )}

                {!prediction.actual_results && race.status === 'completed' && (
                  <div className="border-t border-slate-100 pt-4 mt-4">
                    <p className="text-sm text-amber-700">Results not yet scored. Run backtest from Admin.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
                <p className="text-sm text-slate-600 mb-3">No prediction for this race yet.</p>
                <Link href="/admin" className="text-sm text-teal-700 font-medium hover:underline">Run prediction model</Link>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
