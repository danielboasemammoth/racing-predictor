import { createClient } from '@supabase/supabase-js'
import { loadDailyPicksHistory } from '../src/lib/daily-picks-history'
import type { PredictedHorse } from '../src/lib/types'

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const horseName = process.argv.slice(2).find(value => !value.startsWith('--')) ?? 'Thundering Soul'
  if (process.argv.includes('--history')) {
    const history = await loadDailyPicksHistory(db)
    const matches = history.flatMap(day => day.picks).filter(pick => pick.horse.horse_name.toLowerCase() === horseName.toLowerCase())
    console.log(JSON.stringify({ days: history.map(day => ({ date: day.dateKey, picks: day.picks.length })), matches: matches.map(pick => ({
      horse: pick.horse.horse_name, race: pick.race.id, win: pick.winProbability, top3: pick.top3Probability,
      reliability: pick.reliability, provenance: pick.provenance, observedAt: pick.observedAt, predictionId: pick.predictionId, result: pick.actualPosition,
    })) }, null, 2))
    if (!matches.length) throw new Error('Expected historical horse was not recovered')
    return
  }
  const { data: horses, error: horseError } = await db.from('horses').select('id, name').ilike('name', horseName).limit(10)
  if (horseError) throw horseError
  if (!horses?.length) throw new Error('Horse not found')
  const { data: entries, error: entryError } = await db.from('race_entries')
    .select('horse_id, finishing_position, status, races!inner(id, race_number, race_datetime, status, racecourses(name))')
    .in('horse_id', horses.map(horse => horse.id)).gte('races.race_datetime', '2026-10-02T14:00:00Z').lt('races.race_datetime', '2026-10-03T14:00:00Z')
  if (entryError) throw entryError
  for (const entry of entries ?? []) {
    const race = Array.isArray(entry.races) ? entry.races[0] : entry.races
    const { data: forecasts, error } = await db.from('predictions')
      .select('id, model_version, predicted_at, created_at, podium:predictions->podium')
      .eq('race_id', race.id).in('model_version', ['v6-market-blend', 'v6-market-blend-retrospective'])
      .order('predicted_at').limit(200)
    if (error) throw error
    const typedForecasts = forecasts?.map(forecast => ({ ...forecast, podium: Array.isArray(forecast.podium) ? forecast.podium as unknown as PredictedHorse[] : [] }))
    console.log(JSON.stringify({ entry, forecastCount: forecasts?.length, forecasts: typedForecasts?.filter(forecast => forecast.podium.some(horse => horse.horse_name === horseName && Math.round((horse.win_probability ?? 0) * 100) === 50)).map(forecast => ({
      id: forecast.id, model: forecast.model_version, predictedAt: forecast.predicted_at, createdAt: forecast.created_at,
      podium: forecast.podium?.map(horse => ({ name: horse.horse_name, win: horse.win_probability, top3: horse.top3_probability })),
    })) }, null, 2))
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })