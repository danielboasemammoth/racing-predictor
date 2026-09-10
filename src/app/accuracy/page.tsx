import { createClient } from '@/lib/supabase/server'
import { SiteNav } from '@/components/site-nav'
import { PRODUCTION_MODEL_VERSION } from '@/lib/prediction-suite'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

interface ScoredPredictionRow {
  id: string
  model_version: string
  predicted_winner_id: string | null
  predicted_win_probability: string | null
  predicted_confidence: string | null
  actual_winner_id: string | null
  winner_top3: string | null
  podium_overlap: string | null
  ordered_trifecta: string | null
  winner_brier_score: string | null
  winner_log_loss: string | null
}

async function getModelMetrics() {
  const supabase = await createClient()
  const data: ScoredPredictionRow[] = []
  // Larger than a typical page size on purpose - each row is now just a handful of small scalar
  // fields (not the full jsonb payload), so a bigger page trades a little per-request payload for
  // far fewer sequential round trips (tens of thousands of rows would otherwise mean dozens of
  // requests at 1,000/page).
  const pageSize = 5_000
  // Keyset (id > lastId) pagination, not offset/.range() - the predictions table has grown to
  // tens of thousands of rows, and offset pagination re-scans+discards every prior row on each
  // page, degrading toward a Postgres statement timeout on later pages. Also selects only the
  // handful of scalar fields actually needed (via JSON path operators) instead of the full
  // multi-KB jsonb `predictions`/`actual_results` payload per row - this alone cut one page's
  // query time from ~3s to ~0.4s in a live timing check (see the /accuracy and /picks-history
  // 500 error fixed 2026-09-09).
  let lastId: string | null = null
  for (;;) {
    // Must be a single string literal (not built via array().join()) - Supabase's generated
    // client types the .select() overload from the literal string itself, and a computed
    // `string` falls back to an untyped/error result shape at compile time.
    let query = supabase
      .from('predictions')
      .select(`
        id,
        model_version,
        predicted_winner_id:predictions->podium->0->>horse_id,
        predicted_win_probability:predictions->podium->0->>win_probability,
        predicted_confidence:predictions->podium->0->>confidence,
        actual_winner_id:actual_results->podium->>0,
        winner_top3:actual_results->>winner_top3,
        podium_overlap:actual_results->>podium_overlap,
        ordered_trifecta:actual_results->>ordered_trifecta,
        winner_brier_score:actual_results->>winner_brier_score,
        winner_log_loss:actual_results->>winner_log_loss
      `)
      .not('actual_results', 'is', null)
      .order('id', { ascending: true })
      .limit(pageSize)
    if (lastId) query = query.gt('id', lastId)
    const { data: page, error } = await query
    if (error) throw error
    if (!page?.length) break
    data.push(...(page as unknown as ScoredPredictionRow[]))
    lastId = page[page.length - 1].id
    if (page.length < pageSize) break
  }

  const groups = Map.groupBy(data, (prediction) => prediction.model_version)
  return [...groups].map(([modelVersion, predictions]) => {
    const valid = predictions.filter((prediction) => prediction.actual_winner_id !== null)
    const winnerHits = valid.filter((prediction) => prediction.predicted_winner_id === prediction.actual_winner_id).length
    const predictedProbability = (prediction: ScoredPredictionRow) =>
      Number(prediction.predicted_win_probability ?? prediction.predicted_confidence ?? 0)
    const calibrationGroups = Map.groupBy(valid, (prediction) => Math.min(90, Math.floor(predictedProbability(prediction) * 10) * 10))
    return {
      modelVersion,
      races: valid.length,
      winnerAccuracy: valid.length ? winnerHits / valid.length : 0,
      winnerTop3Accuracy: valid.length
        ? valid.filter((prediction) => prediction.winner_top3 === 'true').length / valid.length
        : 0,
      podiumOverlap: valid.length
        ? valid.reduce((sum, prediction) => sum + Number(prediction.podium_overlap ?? 0), 0) / valid.length
        : 0,
      trifectaAccuracy: valid.length
        ? valid.filter((prediction) => prediction.ordered_trifecta === 'true').length / valid.length
        : 0,
      brierScore: valid.length
        ? valid.reduce((sum, prediction) => sum + Number(prediction.winner_brier_score ?? 0), 0) / valid.length
        : 0,
      logLoss: valid.length
        ? valid.reduce((sum, prediction) => sum + Number(prediction.winner_log_loss ?? 0), 0) / valid.length
        : 0,
      calibration: [...calibrationGroups].sort(([left], [right]) => left - right).map(([band, bucket]) => ({
        band,
        races: bucket.length,
        predicted: bucket.reduce((sum, prediction) => sum + predictedProbability(prediction), 0) / bucket.length,
        observed: bucket.filter((prediction) => prediction.predicted_winner_id === prediction.actual_winner_id).length / bucket.length,
      })),
    }
  }).filter((metric) => metric.races > 0).sort((left, right) => right.races - left.races)
}

function getAccuracyColor(score: number) {
  if (score >= 0.6) return 'text-green-700 bg-green-50'
  if (score >= 0.4) return 'text-amber-700 bg-amber-50'
  return 'text-red-700 bg-red-50'
}

export default async function AccuracyPage() {
  const [logs, modelMetrics] = await Promise.all([getAccuracyLogs(), getModelMetrics()])

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
            <SiteNav />
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
            {modelMetrics.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Model Comparison</h2>
                <p className="text-xs text-slate-500 mb-4">Lower Brier score and log loss are better. Retrospective models use walk-forward history only.</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs text-slate-600">
                        <th className="py-2 pr-4">Model</th>
                        <th className="py-2 px-2">Races</th>
                        <th className="py-2 px-2">Winner</th>
                        <th className="py-2 px-2">Winner top 3</th>
                        <th className="py-2 px-2">Podium overlap</th>
                        <th className="py-2 px-2">Trifecta</th>
                        <th className="py-2 px-2">Brier</th>
                        <th className="py-2 pl-2">Log loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelMetrics.map((metric) => (
                        <tr key={metric.modelVersion} className="border-b border-slate-100 last:border-0">
                          <td className="py-3 pr-4 font-medium text-slate-900">{metric.modelVersion}</td>
                          <td className="py-3 px-2">{metric.races}</td>
                          <td className="py-3 px-2">{(metric.winnerAccuracy * 100).toFixed(1)}%</td>
                          <td className="py-3 px-2">{(metric.winnerTop3Accuracy * 100).toFixed(1)}%</td>
                          <td className="py-3 px-2">{(metric.podiumOverlap * 100).toFixed(1)}%</td>
                          <td className="py-3 px-2">{(metric.trifectaAccuracy * 100).toFixed(1)}%</td>
                          <td className="py-3 px-2">{metric.brierScore.toFixed(3)}</td>
                          <td className="py-3 pl-2">{metric.logLoss.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {modelMetrics.find((metric) => metric.modelVersion === `${PRODUCTION_MODEL_VERSION}-retrospective`)?.calibration.length ? (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Winner Calibration</h2>
                <p className="text-xs text-slate-500 mb-4">Predicted confidence should approach the observed win rate as the sample grows.</p>
                <div className="space-y-3">
                  {modelMetrics.find((metric) => metric.modelVersion === `${PRODUCTION_MODEL_VERSION}-retrospective`)!.calibration.map((bucket) => (
                    <div key={bucket.band} className="grid grid-cols-[72px_1fr_110px] items-center gap-3 text-xs">
                      <span className="font-medium text-slate-700">{bucket.band}–{bucket.band + 9}%</span>
                      <div className="h-2 overflow-hidden rounded bg-slate-100">
                        <div className="h-full bg-teal-600" style={{ width: `${Math.min(100, bucket.observed * 100)}%` }} />
                      </div>
                      <span className="text-right text-slate-600">{(bucket.predicted * 100).toFixed(0)}% / {(bucket.observed * 100).toFixed(0)}% · {bucket.races}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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
                  {new Date(latest.period_start).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', timeZone: 'Australia/Sydney' })} – {new Date(latest.period_end).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', timeZone: 'Australia/Sydney' })}
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
                        {new Date(log.period_start).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })} – {new Date(log.period_end).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney' })}
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
