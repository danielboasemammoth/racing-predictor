import { createScriptClient } from './supabase-client'
import { PRODUCTION_MODEL_VERSION } from '../src/lib/prediction-suite'
import { buildPlaceStudyRace, runPlaceCalibrationStudy, type PlaceStudyRace, type PlaceStudyPrediction } from '../src/lib/betting/place-calibration-study'
import { loadValidationBets, policyPerformance } from '../src/lib/paper-betting/validation-query'
import { melbourneDateKey } from '../src/lib/daily-picks'

async function main() {
  const admin = createScriptClient()
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const races: Array<{ id: string; race_datetime: string }> = []
  for (let offset = 0; ; offset += 1000) {
    const result = await admin.from('races').select('id,race_datetime').eq('status', 'completed')
      .gte('race_datetime', cutoff).order('race_datetime').order('id').range(offset, offset + 999)
    if (result.error) throw result.error
    races.push(...result.data)
    if (result.data.length < 1000) break
  }

  const samples: PlaceStudyRace[] = []
  const exclusions: Record<string, number> = {}
  for (let offset = 0; offset < races.length; offset += 20) {
    const chunk = races.slice(offset, offset + 20)
    const ids = chunk.map((race) => race.id)
    const [entries, predictions] = await Promise.all([
      admin.from('race_entries').select('race_id,horse_id,status,finishing_position').in('race_id', ids),
      admin.from('predictions').select('race_id,predicted_at,predictions').in('race_id', ids)
        .eq('model_version', PRODUCTION_MODEL_VERSION).order('predicted_at', { ascending: false }),
    ])
    if (entries.error) throw entries.error
    if (predictions.error) throw predictions.error
    if (entries.data.length >= 1000 || predictions.data.length >= 1000) throw new Error('Query row cap reached; reduce the race batch size before evaluating')
    for (const race of chunk) {
      const result = buildPlaceStudyRace(race,
        predictions.data.filter((row) => row.race_id === race.id) as PlaceStudyPrediction[],
        entries.data.filter((row) => row.race_id === race.id))
      if (result.sample) samples.push(result.sample)
      else exclusions[result.reason!] = (exclusions[result.reason!] ?? 0) + 1
    }
  }
  const account = await admin.from('paper_accounts').select('id').eq('name', 'default').single()
  if (account.error) throw account.error
  const peBets = (await loadValidationBets(admin, account.data.id)).filter((bet) => bet.source === 'puntersedge' && bet.bet_type === 'PLACE')
  const days = new Set(samples.map((race) => melbourneDateKey(race.startTime)))
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    cutoff,
    modelVersion: PRODUCTION_MODEL_VERSION,
    completedRaces: races.length,
    eligibleRaces: samples.length,
    eligibleDays: days.size,
    exclusions,
    method: 'One-parameter shrinkage toward 3/field-size, fitted by race-weighted Brier on training days only; whole-day chronological 60/20/20 split.',
    priceReplayCaveat: 'Flat $1 stakes at forecast-recorded prices only. Not executable TAB prices or an exact replay of hourly timing, wallet limits, and policy eligibility.',
    internal: days.size >= 5 ? runPlaceCalibrationStudy(samples) : { blocked: 'Fewer than five eligible pre-race days; no fitting or test scoring performed.' },
    puntersedge: {
      decidedPlaceBets: peBets.length,
      distinctRaces: new Set(peBets.map((bet) => bet.race_id)).size,
      policies: policyPerformance(peBets),
      correctionApplied: false,
      limitation: 'Selected-bet history, not full-field forecasts; do not transfer internal calibration to this hybrid or pool models/categories. No correction is fitted here.',
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})