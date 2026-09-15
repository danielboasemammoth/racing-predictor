import { createScriptClient } from './supabase-client'
import { CURRENT_MODEL_VERSIONS } from '../src/lib/prediction-suite'
import type { PredictionPayload } from '../src/lib/types'

interface Score {
  hit: number
  brier: number
  logLoss: number
  placeBrier: number | null
}

function summarize(rows: Score[]) {
  const placeRows = rows.filter((row) => row.placeBrier != null)
  return {
    n: rows.length,
    winnerAccuracy: rows.length ? rows.reduce((sum, row) => sum + row.hit, 0) / rows.length : null,
    brier: rows.length ? rows.reduce((sum, row) => sum + row.brier, 0) / rows.length : null,
    logLoss: rows.length ? rows.reduce((sum, row) => sum + row.logLoss, 0) / rows.length : null,
    placeN: placeRows.length,
    placeBrier: placeRows.length ? placeRows.reduce((sum, row) => sum + row.placeBrier!, 0) / placeRows.length : null,
  }
}

async function main() {
  const db = createScriptClient()
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const races: Array<{ id: string; race_datetime: string }> = []
  for (let offset = 0; ; offset += 1000) {
    const response = await db.from('races').select('id,race_datetime')
      .eq('status', 'completed').gte('race_datetime', cutoff).order('id').range(offset, offset + 999)
    if (response.error) throw response.error
    races.push(...response.data)
    if (response.data.length < 1000) break
  }
  const scored = new Map(CURRENT_MODEL_VERSIONS.map((version) => [version, new Map<string, Score>()]))
  for (let offset = 0; offset < races.length; offset += 20) {
    const chunk = races.slice(offset, offset + 20)
    const ids = chunk.map((race) => race.id)
    const [entries, predictions] = await Promise.all([
      db.from('race_entries').select('race_id,horse_id,status,finishing_position').in('race_id', ids),
      db.from('predictions').select('race_id,model_version,predicted_at,predictions')
        .in('race_id', ids).in('model_version', CURRENT_MODEL_VERSIONS).order('predicted_at', { ascending: false }),
    ])
    if (entries.error) throw entries.error
    if (predictions.error) throw predictions.error
    if (entries.data.length >= 1000 || predictions.data.length >= 1000) throw new Error('Chunk hit row cap; reduce the batch size before scoring')
    for (const race of chunk) {
      const active = entries.data.filter((entry) => entry.race_id === race.id && entry.status !== 'scratched')
      const winners = active.filter((entry) => entry.finishing_position === 1)
      if (winners.length !== 1) continue
      for (const version of CURRENT_MODEL_VERSIONS) {
        const prediction = predictions.data.find((row) => row.race_id === race.id && row.model_version === version
          && Date.parse(row.predicted_at) < Date.parse(race.race_datetime))
        if (!prediction) continue
        const payload = prediction.predictions as PredictionPayload
        const horses = payload.all_horses
        if (!horses || horses.length !== active.length || !active.every((entry) => horses.some((horse) => horse.horse_id === entry.horse_id))) continue
        const probabilities = horses.map((horse) => horse.win_probability ?? horse.confidence)
        if (probabilities.some((probability) => !Number.isFinite(probability) || probability < 0 || probability > 1)) continue
        const winner = horses.find((horse) => horse.horse_id === winners[0].horse_id)!
        const brier = horses.reduce((sum, horse) => sum + ((horse.win_probability ?? horse.confidence) - (horse.horse_id === winner.horse_id ? 1 : 0)) ** 2, 0) / horses.length
        const placeBrier = active.length >= 8 && horses.every((horse) => horse.top3_probability != null && Number.isFinite(horse.top3_probability))
          ? horses.reduce((sum, horse) => {
            const entry = active.find((runner) => runner.horse_id === horse.horse_id)!
            return sum + (horse.top3_probability! - (entry.finishing_position >= 1 && entry.finishing_position <= 3 ? 1 : 0)) ** 2
          }, 0) / horses.length
          : null
        scored.get(version)!.set(race.id, {
          hit: payload.podium[0]?.horse_id === winner.horse_id ? 1 : 0,
          brier,
          logLoss: -Math.log(Math.max(winner.win_probability ?? winner.confidence, 1e-9)),
          placeBrier,
        })
      }
    }
  }
  const common = races.map((race) => race.id).filter((id) => CURRENT_MODEL_VERSIONS.every((version) => scored.get(version)!.has(id)))
  console.log(JSON.stringify({
    cutoff,
    completedRaces: races.length,
    pairedRaces: common.length,
    models: CURRENT_MODEL_VERSIONS.map((version) => ({
      version,
      available: summarize([...scored.get(version)!.values()]),
      paired: summarize(common.map((id) => scored.get(version)!.get(id)!)),
    })),
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})