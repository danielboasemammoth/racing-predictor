import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { RaceWithPrediction } from '@/lib/types'

export const dynamic = 'force-dynamic'

async function getRaceData(raceId: string) {
  const supabase = await createClient()
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

  const { data: prediction } = await supabase
    .from('predictions')
    .select('*')
    .eq('race_id', raceId)
    .order('predicted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    race,
    entries: entries || [],
    prediction: prediction || null
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

export default async function RaceDetailPage({ params }: { params: { id: string } }) {
  const data = await getRaceData(params.id)

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
            <div className="grid grid-cols-3 gap-4">
              {prediction.predictions?.podium?.map((horse: any, idx: number) => (
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
                  {horse.confidence && (
                    <p className="text-xs text-slate-500 ml-8">{(horse.confidence * 100).toFixed(0)}%</p>
                  )}
                </div>
              ))}
            </div>
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
                {entries.map((entry: any) => (
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
