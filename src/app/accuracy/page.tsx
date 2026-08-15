import { supabase } from '@/lib/supabase'
import { AccuracyLog } from '@/lib/types'
import Link from 'next/link'

async function getAccuracyLogs() {
  const { data } = await supabase
    .from('accuracy_log')
    .select('*')
    .order('period_end', { ascending: false })
    .limit(30)

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
  const previous = logs[1]

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Accuracy Dashboard</h1>
              <p className="text-sm text-slate-600 mt-1">Track how the prediction model improves over time</p>
            </div>
            <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">← Races</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {logs.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <p className="text-slate-600 mb-2">No accuracy data yet.</p>
            <p className="text-sm text-slate-500">Complete some races and run backtests from Admin to generate accuracy metrics.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Latest stats */}
            {latest && (
              <div className="grid md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <div className="text-sm text-slate-600 mb-1">Latest Winner Accuracy</div>
                  <div className={`text-3xl font-bold ${getAccuracyColor(latest.winner_accuracy)}`}>
                    {(latest.winner_accuracy * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    {latest.correct_winners}/{latest.total_races} races
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <div className="text-sm text-slate-600 mb-1">Latest Podium Accuracy</div>
                  <div className={`text-3xl font-bold ${getAccuracyColor(latest.podium_accuracy)}`}>
                    {(latest.podium_accuracy * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    Top 3 predicted correctly
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <div className="text-sm text-slate-600 mb-1">Model Version</div>
                  <div className="text-3xl font-bold text-slate-900">
                    {latest.model_version || '—'}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    {latest.total_races} races evaluated
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <div className="text-sm text-slate-600 mb-1">Trend</div>
                  <div className="text-3xl font-bold text-slate-900">
                    {previous ? (
                      latest.winner_accuracy > previous.winner_accuracy ? '↑' :
                      latest.winner_accuracy < previous.winner_accuracy ? '↓' : '→'
                    ) : '—'}
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    {previous ? `vs ${previous.model_version}` : 'No previous data'}
                  </div>
                </div>
              </div>
            )}

            {/* Accuracy log */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Historical Accuracy</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 text-slate-600 font-medium">Period</th>
                      <th className="text-left py-2 text-slate-600 font-medium">Races</th>
                      <th className="text-left py-2 text-slate-600 font-medium">Correct Winners</th>
                      <th className="text-left py-2 text-slate-600 font-medium">Winner Accuracy</th>
                      <th className="text-left py-2 text-slate-600 font-medium">Podium Accuracy</th>
                      <th className="text-left py-2 text-slate-600 font-medium">Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log: AccuracyLog) => (
                      <tr key={log.id} className="border-b border-slate-100">
                        <td className="py-3 text-slate-900">
                          {log.period_start} → {log.period_end}
                        </td>
                        <td className="py-3 text-slate-600">{log.total_races}</td>
                        <td className="py-3 text-slate-600">{log.correct_winners}</td>
                        <td className="py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getAccuracyColor(log.winner_accuracy)}`}>
                            {(log.winner_accuracy * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getAccuracyColor(log.podium_accuracy)}`}>
                            {(log.podium_accuracy * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-3 text-slate-600">{log.model_version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
