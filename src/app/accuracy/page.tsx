import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

async function getAccuracyLogs() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('accuracy_log')
    .select('*')
    .order('period_end', { ascending: false })
    .limit(30)

  if (error) throw error
  return data || []
}

function getAccuracyColor(score: number) {
  if (score >= 0.6) return 'text-green-700 bg-green-50'
  if (score >= 0.4) return 'text-amber-700 bg-amber-50'
  return 'text-red-700 bg-red-50'
}

export default async function AccuracyPage() {
  const logs = await getAccuracyLogs()

  const latest = logs[0]
  const totalRaces = logs.reduce((sum, log) => sum + log.total_races, 0)
  const avgWinner = totalRaces > 0
    ? logs.reduce((sum, log) => sum + log.correct_winners, 0) / totalRaces
    : 0
  const avgPodium = totalRaces > 0
    ? logs.reduce((sum, log) => sum + log.correct_podiums, 0) / totalRaces
    : 0

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Accuracy Dashboard</h1>
              <p className="text-sm text-slate-600 mt-1">Track model performance over time</p>
            </div>
            <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">← Back to races</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {logs.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <p className="text-slate-600 mb-2">No accuracy data yet.</p>
            <p className="text-sm text-slate-500">Run predictions and backtest to populate this dashboard.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <p className="text-sm text-slate-600 mb-1">Overall Winner Accuracy</p>
                <p className={`text-3xl font-bold ${getAccuracyColor(avgWinner)}`}>
                  {(avgWinner * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500 mt-1">Across {totalRaces} races</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <p className="text-sm text-slate-600 mb-1">Overall Podium Accuracy</p>
                <p className={`text-3xl font-bold ${getAccuracyColor(avgPodium)}`}>
                  {(avgPodium * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500 mt-1">Across {totalRaces} races</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <p className="text-sm text-slate-600 mb-1">Latest Period</p>
                <p className="text-3xl font-bold text-slate-900">
                  {new Date(latest.period_start).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })} – {new Date(latest.period_end).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}
                </p>
                <p className="text-xs text-slate-500 mt-1">{latest.total_races} races</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Accuracy History</h2>
              <div className="space-y-3">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between py-3 border-b border-slate-100 last:border-b-0">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {new Date(log.period_start).toLocaleDateString('en-AU')} – {new Date(log.period_end).toLocaleDateString('en-AU')}
                      </p>
                      <p className="text-xs text-slate-500">{log.total_races} races • {log.model_version || 'unknown model'}</p>
                    </div>
                    <div className="flex gap-4 text-right">
                      <div>
                        <p className="text-xs text-slate-600">Winner</p>
                        <p className={`text-sm font-semibold ${getAccuracyColor(log.winner_accuracy)}`}>
                          {(log.winner_accuracy * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-600">Podium</p>
                        <p className={`text-sm font-semibold ${getAccuracyColor(log.podium_accuracy)}`}>
                          {(log.podium_accuracy * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
