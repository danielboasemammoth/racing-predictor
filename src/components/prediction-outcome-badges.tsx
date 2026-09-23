interface OutcomeEntry {
  horse_id: string
  finishing_position: number | null
  status?: string
}

interface OutcomePrediction {
  horse_id: string
  predicted_position: number
}

export function PredictionOutcomeBadges({ predictions, entries }: {
  predictions: OutcomePrediction[]
  entries: OutcomeEntry[]
}) {
  const predicted = predictions.filter(horse => horse.predicted_position >= 1 && horse.predicted_position <= 3)
  const finished = entries.filter(entry => entry.status !== 'scratched' && entry.finishing_position !== null && entry.finishing_position > 0)
  if (!predicted.length || !finished.length) return null

  const podium = new Set(finished.filter(entry => entry.finishing_position! <= 3).map(entry => entry.horse_id))
  const hits = new Set(predicted.filter(horse => podium.has(horse.horse_id)).map(horse => horse.horse_id)).size

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {[1, 2, 3].map(position => {
        const pick = predicted.find(horse => horse.predicted_position === position)
        const actual = finished.filter(entry => entry.finishing_position === position)
        if (!pick || !actual.length) return null
        const hit = actual.some(entry => entry.horse_id === pick.horse_id)
        const label = position === 1 ? 'Winner' : `${position === 2 ? '2nd' : '3rd'} place`
        return (
          <span key={position} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${hit ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-red-300 bg-red-50 text-red-800'}`}>
            {label} {hit ? 'predicted correctly' : 'missed'}
          </span>
        )
      })}
      <span className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
        Podium hits: {hits}/{predicted.length}
      </span>
    </div>
  )
}