import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Prediction, Race, RaceEntryWithHorse } from '@/lib/types'

export const dynamic = 'force-dynamic'

async function getRaceData(raceId: string) {
  const supabase = await createClient()
  const { data: race, error: raceError } = await supabase
    .from('races')
    .select('*, racecourses(*)')
    .eq('id', raceId)
    .maybeSingle()

  if (raceError) throw raceError
  if (!race) return null

  const { data: entries, error: entriesError } = await supabase
    .from('race_entries')
    .select('*, horses(*)')
    .eq('race_id', raceId)
    .order('barrier_number', { ascending: true })

  if (entriesError) throw entriesError

  const { data: prediction, error: predictionError } = await supabase
    .from('predictions')
    .select('*')
    .eq('race_id', raceId)
    .order('predicted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (predictionError) throw predictionError

  return {
    race: race as Race,
    entries: (entries ?? []) as RaceEntryWithHorse[],
    prediction: prediction as Prediction | null
  }
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

export default async function RaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getRaceData(id)

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <p className="text-slate-600">Race not found.</p>
          <Link href="/" className="text-teal-700 font-medium hover:underline mt-2 inline-block">← Back to races</Link>
        </div>
      </div>
    )
  }

  const { race, entries, prediction } = data

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{race.racecourses?.name}</h1>
              <p className="text-sm text-slate-600 mt-1">Race {race.race_number} — {race.race_name}</p>
            </div>
            <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">← Back</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
            <span>{formatDateTime(race.race_datetime)}</span>
            <span>{formatDistance(race.distance_m || 0)}</span>
            {race.track_condition && <span className="capitalize">{race.track_condition}</span>}
            {race.weather_condition && <span className="capitalize">{race.weather_condition}</span>}
            {race.race_class && <span>{race.race_class}</span>}
            {race.prize_money && <span>A${Number(race.prize_money).toLocaleString()}</span>}
          </div>
        </div>

        {prediction && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Prediction</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {prediction.predictions.podium.map((horse, idx) => (
                <div key={horse.horse_id} className={`rounded-lg p-4 ${idx === 0 ? 'bg-amber-50 border-2 border-amber-300' : 'bg-slate-50 border border-slate-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${idx === 0 ? 'bg-amber-400 text-white' : 'bg-slate-300 text-slate-700'}`}>
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-slate-900 text-sm">{horse.horse_name}</span>
                  </div>
                  {horse.predicted_time && (
                    <p className="text-xs text-slate-600 ml-8">Predicted: {horse.predicted_time}s</p>
                  )}
                  <div className="ml-8 space-y-1 text-xs text-slate-600">
                    <p>{((horse.win_probability ?? horse.confidence) * 100).toFixed(0)}% win</p>
                    {horse.top3_probability !== undefined && <p>{(horse.top3_probability * 100).toFixed(0)}% top 3</p>}
                    {horse.win_return_10 !== undefined && <p>${horse.win_return_10.toFixed(2)} return / $10 win</p>}
                    {horse.place_return_10 !== undefined && <p>${horse.place_return_10.toFixed(2)} return / $10 place</p>}
                    {horse.value_rating !== 'neutral' && <p className="font-semibold text-emerald-700">{horse.value_rating} model value</p>}
                  </div>
                </div>
              ))}
            </div>
            {prediction.predictions.trifecta && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">
                  Trifecta: {prediction.predictions.trifecta.horse_names.join(' → ')} · {(prediction.predictions.trifecta.probability * 100).toFixed(1)}% model likelihood
                </p>
                <p className="mt-1">Model-fair $10 return approximately ${prediction.predictions.trifecta.fair_return_10.toFixed(0)}. Actual pool dividend will vary.</p>
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Field</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 px-2">Pos</th>
                  <th className="text-left py-2 px-2">Horse</th>
                  <th className="text-left py-2 px-2">Barrier</th>
                  <th className="text-left py-2 px-2">Weight</th>
                  <th className="text-left py-2 px-2">Jockey</th>
                  <th className="text-left py-2 px-2">Trainer</th>
                  <th className="text-left py-2 px-2">Time</th>
                  <th className="text-left py-2 px-2">Margin</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-100">
                    <td className="py-2 px-2">{entry.finishing_position || '—'}</td>
                    <td className="py-2 px-2 font-medium">{entry.horses?.name || 'Unknown'}</td>
                    <td className="py-2 px-2">{entry.barrier_number || '—'}</td>
                    <td className="py-2 px-2">{entry.weight_carried || '—'}</td>
                    <td className="py-2 px-2">{entry.jockey || '—'}</td>
                    <td className="py-2 px-2">{entry.trainer || '—'}</td>
                    <td className="py-2 px-2">{entry.finishing_time || '—'}</td>
                    <td className="py-2 px-2">{entry.margin || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
