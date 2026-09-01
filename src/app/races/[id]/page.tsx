import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Prediction, Race, RaceEntryWithHorse } from '@/lib/types'
import { CURRENT_MODEL_VERSIONS } from '@/lib/prediction-suite'
import { computeRaceReliability, loadReliabilityContext } from '@/lib/reliability-context'
import { hasAdminSession } from '@/lib/admin-auth'
import { RefreshRaceButton } from './refresh-race-button'
import { SiteNav } from '@/components/site-nav'

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
    .neq('status', 'scratched')
    .order(race.status === 'completed' ? 'finishing_position' : 'barrier_number', { ascending: true })

  if (entriesError) throw entriesError

  const { data: predictionRows, error: predictionError } = await supabase
    .from('predictions')
    .select('*')
    .eq('race_id', raceId)
    .order('predicted_at', { ascending: false })

  if (predictionError) throw predictionError
  // Completed races must use the retrospective predictions (built only from pre-race history,
  // with scratched horses excluded at generation time) - the live, non-retrospective predictions
  // for that same race are frozen from whenever they were last generated pre-race and can go
  // stale (e.g. still including a horse that was scratched afterwards).
  const wantsRetrospective = race.status === 'completed'
  const modelPredictions: Prediction[] = []
  for (const prediction of (predictionRows ?? []) as Prediction[]) {
    const isRetrospective = prediction.model_version.includes('retrospective')
    if (isRetrospective !== wantsRetrospective) continue
    const baseVersion = prediction.model_version.replace('-retrospective', '')
    if (!CURRENT_MODEL_VERSIONS.includes(baseVersion)) continue
    if (!modelPredictions.some((model) => model.model_version.replace('-retrospective', '') === baseVersion)) modelPredictions.push(prediction)
  }
  const prediction = modelPredictions.find((model) => model.model_version.replace('-retrospective', '') === 'v4.1-ensemble')
    ?? modelPredictions[0]
    ?? null

  const typedEntries = (entries ?? []) as RaceEntryWithHorse[]
  const reliabilityContext = await loadReliabilityContext(supabase)
  const raceReliability = reliabilityContext
    ? computeRaceReliability(race, typedEntries, prediction, modelPredictions, reliabilityContext)
    : null

  // Every prediction run inserts a new immutable snapshot rather than overwriting, so the full
  // history of how this pick evolved (right up to jump time) is just a filter + sort away.
  const predictionHistory = prediction
    ? ((predictionRows ?? []) as Prediction[])
        .filter((row) => row.model_version === prediction.model_version)
        .sort((left, right) => new Date(left.predicted_at).getTime() - new Date(right.predicted_at).getTime())
        .map((row) => {
          const winner = row.predictions.podium[0]
          const second = row.predictions.podium[1]
          const winnerProbability = winner ? (winner.win_probability ?? winner.confidence) : 0
          const secondProbability = second ? (second.win_probability ?? second.confidence) : 0
          return {
            predictedAt: row.predicted_at,
            topPick: winner?.horse_name ?? 'No pick',
            probability: winnerProbability,
            gap: Math.max(0, winnerProbability - secondProbability),
          }
        })
    : []

  return {
    race: race as Race,
    entries: typedEntries,
    prediction,
    modelPredictions,
    raceReliability,
    predictionHistory,
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
  const [data, isAdmin] = await Promise.all([getRaceData(id), hasAdminSession()])

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

  const { race, entries, prediction, modelPredictions, raceReliability, predictionHistory } = data

  // Filter out scratched horses from prediction picks
  const scratchedHorseIds = new Set(entries.filter(e => e.status === 'scratched').map(e => e.horse_id))
  const filteredPrediction = prediction
    ? {
        ...prediction,
        predictions: {
          ...prediction.predictions,
          podium: prediction.predictions.podium.filter(h => !scratchedHorseIds.has(h.horse_id)),
          all_horses: prediction.predictions.all_horses?.filter(h => !scratchedHorseIds.has(h.horse_id)),
        },
      }
    : prediction

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{race.racecourses?.name}</h1>
              <p className="text-sm text-slate-600 mt-1">Race {race.race_number} — {race.race_name}</p>
            </div>
            <div className="flex items-center gap-4">
              {isAdmin && <RefreshRaceButton raceId={race.id} />}
              <SiteNav />
            </div>
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

        {filteredPrediction && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Prediction</h2>
            {modelPredictions.length > 1 && (
              <div className="mb-5">
                <p className="mb-2 text-xs font-bold uppercase text-slate-600">Model confidence comparison</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {modelPredictions.sort((left, right) => left.model_version.localeCompare(right.model_version)).map((model) => {
                    const winner = model.predictions.podium[0]
                    const baseVersion = model.model_version.replace('-retrospective', '')
                    return (
                      <div key={model.model_version} className={`border p-3 ${baseVersion === 'v4.1-ensemble' ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-slate-50'}`}>
                        <p className="text-xs font-semibold text-slate-500">{baseVersion}</p>
                        <p className="mt-1 font-bold text-slate-900">{winner?.horse_name ?? 'No pick'}</p>
                        <p className="text-sm text-slate-600">Winner confidence {((model.confidence_scores.winner ?? 0) * 100).toFixed(1)}%</p>
                        {(model.confidence_scores.winner ?? 0) >= 0.25 && (
                          <p className="mt-1 text-xs font-bold uppercase text-emerald-700">Lower-risk confidence band</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {filteredPrediction.predictions.podium.map((horse, idx) => (
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
            {filteredPrediction.predictions.trifecta && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">
                  Trifecta: {filteredPrediction.predictions.trifecta.horse_names.join(' → ')} · {(filteredPrediction.predictions.trifecta.probability * 100).toFixed(1)}% model likelihood
                </p>
                <p className="mt-1">Model-fair $10 return approximately ${filteredPrediction.predictions.trifecta.fair_return_10.toFixed(0)}. Actual pool dividend will vary.</p>
              </div>
            )}
          </div>
        )}

        {raceReliability && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Prediction Reliability</h2>
                <p className="mt-1 text-sm text-slate-600">
                  How closely this race resembles historical conditions where the model has performed reliably - not a guarantee.
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-slate-900">{raceReliability.reliability.score}<span className="text-base font-medium text-slate-500">/100</span></p>
                <p className="text-sm font-semibold text-teal-700">{raceReliability.reliability.classification}</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase text-emerald-700">Positive Factors</p>
                {raceReliability.reliability.factors.filter((factor) => factor.liftVsBaseline >= 0).length ? (
                  <ul className="mt-2 space-y-2">
                    {raceReliability.reliability.factors.filter((factor) => factor.liftVsBaseline >= 0).map((factor) => (
                      <li key={factor.label} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold text-slate-900">{factor.label}</p>
                        <p className="mt-0.5">
                          {(factor.observedStrikeRate * 100).toFixed(1)}% historical strike rate (+{(factor.liftVsBaseline * 100).toFixed(1)}pts vs baseline, n={factor.sampleSize})
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">None of the validated factors favour this pick.</p>
                )}
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-red-700">Negative Factors</p>
                {raceReliability.reliability.factors.filter((factor) => factor.liftVsBaseline < 0).length ? (
                  <ul className="mt-2 space-y-2">
                    {raceReliability.reliability.factors.filter((factor) => factor.liftVsBaseline < 0).map((factor) => (
                      <li key={factor.label} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold text-slate-900">{factor.label}</p>
                        <p className="mt-0.5">
                          {(factor.observedStrikeRate * 100).toFixed(1)}% historical strike rate ({(factor.liftVsBaseline * 100).toFixed(1)}pts vs baseline, n={factor.sampleSize})
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">None of the validated factors count against this pick.</p>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Evidence confidence: <span className="font-semibold">{raceReliability.reliability.evidenceConfidence}</span> (based on {raceReliability.reliability.evidenceSampleSize} comparable historical races)
            </p>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-xs font-bold uppercase text-slate-600">Similar historical races</p>
              <p className="mt-1 text-sm text-slate-700">
                <span className="font-semibold">{raceReliability.similarRaces.n}</span> comparable races (matched on {raceReliability.similarRaces.criteriaUsed.join(', ')}) ·{' '}
                <span className="font-semibold">{raceReliability.similarRaces.wins}</span> wins ·{' '}
                strike rate {(raceReliability.similarRaces.strikeRate * 100).toFixed(1)}% vs {(raceReliability.similarRaces.baseline * 100).toFixed(1)}% baseline
                {' '}({raceReliability.similarRaces.lift >= 0 ? '+' : ''}{(raceReliability.similarRaces.lift * 100).toFixed(1)}pts)
              </p>
              <p className="mt-1 text-xs text-slate-500">Evidence confidence: {raceReliability.similarRaces.evidenceConfidence}</p>
            </div>
          </div>
        )}

        {raceReliability?.modelEdge && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-slate-900">Model Edge</h2>
            <p className="mt-1 text-sm text-slate-600">
              A separate question from Reliability: is this pick priced attractively, not just likely to win.
              Uses the best price recorded in Racing.com&apos;s own feed - not a confirmed TAB Fixed Win or Betfair SP.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Best recorded price</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">${raceReliability.modelEdge.bestRecordedOdds.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Market-implied probability</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">{(raceReliability.modelEdge.marketImpliedProbability * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Model Edge</p>
                <p className={`mt-0.5 text-lg font-bold ${raceReliability.modelEdge.edge >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {raceReliability.modelEdge.edge >= 0 ? '+' : ''}{(raceReliability.modelEdge.edge * 100).toFixed(1)}pts
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Historical ROI ({raceReliability.modelEdge.edgeBand})</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900">
                  {raceReliability.modelEdge.historicalRoi
                    ? `${raceReliability.modelEdge.historicalRoi.roi >= 0 ? '+' : ''}${(raceReliability.modelEdge.historicalRoi.roi * 100).toFixed(1)}%`
                    : 'Not enough data'}
                </p>
              </div>
            </div>
            {raceReliability.modelEdge.historicalRoi && (
              <p className="mt-2 text-xs text-slate-500">
                Based on {raceReliability.modelEdge.historicalRoi.bets} historical flat-stake bets in this edge band. A positive Model Edge does not guarantee a positive ROI - always check this figure.
              </p>
            )}
          </div>
        )}

        {predictionHistory.length > 1 && (
          <details className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <summary className="cursor-pointer text-lg font-semibold text-slate-900">
              Prediction History <span className="text-sm font-normal text-slate-500">({predictionHistory.length} snapshots)</span>
            </summary>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pr-4">Predicted at</th>
                    <th className="py-2 pr-4">Top selection</th>
                    <th className="py-2 pr-4">Win probability</th>
                    <th className="py-2 pr-4">Gap to #2</th>
                  </tr>
                </thead>
                <tbody>
                  {predictionHistory.map((snapshot) => (
                    <tr key={snapshot.predictedAt} className="border-b border-slate-100">
                      <td className="py-2 pr-4 text-slate-600">{formatDateTime(snapshot.predictedAt)}</td>
                      <td className="py-2 pr-4 font-medium text-slate-900">{snapshot.topPick}</td>
                      <td className="py-2 pr-4">{(snapshot.probability * 100).toFixed(0)}%</td>
                      <td className="py-2 pr-4">{(snapshot.gap * 100).toFixed(1)}pts</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Shows whether the model&apos;s pick and confidence converged or diverged as new data came in.</p>
          </details>
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
