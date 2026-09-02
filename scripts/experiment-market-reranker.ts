/**
 * EXPERIMENT (audit spec Parts 15/41/47): does blending the model's own probability with the
 * race's normalized market probability - picking whichever runner has the highest blended score -
 * beat the model alone? Tests over the WHOLE field (not just the model's top 3), since the error
 * analysis (scripts/prediction-error-analysis.ts) showed the winner is outside the model's top 5
 * in 37.7% of races - restricting the reranker to the top 3 would structurally cap its upside.
 * Chronological discovery/holdout split (never random) - alpha is chosen on discovery only and
 * verified once, untouched, on holdout, per the spec's own repeated walk-forward requirement.
 * Read-only - replays existing stored predictions/results, writes nothing.
 */
import 'dotenv/config'
import { createScriptClient } from './supabase-client'
import { extractBestWinOdds } from '../src/lib/roi-analysis'
import { normalizedMarketProbabilities } from '../src/lib/reliability-analysis'
import type { PredictionPayload } from '../src/lib/types'

const MODEL_VERSION = 'v4.1-ensemble'
const ALPHAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

interface RaceHorse {
  horseId: string
  modelProb: number
  marketProb: number | null
  isWinner: boolean
}

async function main() {
  const supabase = createScriptClient()

  const predictions: { race_id: string; predictions: PredictionPayload }[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('predictions')
      .select('race_id, predictions, actual_results')
      .eq('model_version', MODEL_VERSION)
      .not('actual_results', 'is', null)
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    predictions.push(...(data ?? []))
    if (!data || data.length < pageSize) break
  }

  const raceIds = [...new Set(predictions.map((p) => p.race_id))]
  const raceDates = new Map<string, string>()
  const entriesByRace = new Map<string, { horse_id: string; finishing_position: number | null; sectional_times: unknown }[]>()
  const chunkSize = 80
  for (let i = 0; i < raceIds.length; i += chunkSize) {
    const chunk = raceIds.slice(i, i + chunkSize)
    const [racesRes, entriesRes] = await Promise.all([
      supabase.from('races').select('id, race_datetime').in('id', chunk),
      supabase.from('race_entries').select('race_id, horse_id, finishing_position, sectional_times').in('race_id', chunk),
    ])
    if (racesRes.error) throw racesRes.error
    if (entriesRes.error) throw entriesRes.error
    for (const r of racesRes.data ?? []) raceDates.set(r.id, r.race_datetime)
    for (const row of entriesRes.data ?? []) {
      const list = entriesByRace.get(row.race_id) ?? []
      list.push(row)
      entriesByRace.set(row.race_id, list)
    }
  }

  // Build one race record per prediction: full field with model + normalized market probability.
  interface RaceRecord { raceId: string; date: string; horses: RaceHorse[] }
  const races: RaceRecord[] = []
  for (const row of predictions) {
    const entries = entriesByRace.get(row.race_id) ?? []
    const date = raceDates.get(row.race_id)
    if (!date || !entries.length) continue
    const field = row.predictions.all_horses?.length ? row.predictions.all_horses : row.predictions.podium
    if (!field.length) continue

    const oddsByHorse = new Map(entries.map((e) => [e.horse_id, extractBestWinOdds(e.sectional_times)]))
    const pricedHorseIds = entries.filter((e) => oddsByHorse.get(e.horse_id) != null).map((e) => e.horse_id)
    const normalized = normalizedMarketProbabilities(pricedHorseIds.map((id) => oddsByHorse.get(id)!))
    const marketProbByHorse = new Map(pricedHorseIds.map((id, i) => [id, normalized[i]]))

    const winnerId = entries.find((e) => e.finishing_position === 1)?.horse_id
    if (!winnerId) continue

    races.push({
      raceId: row.race_id,
      date,
      horses: field.map((h) => ({
        horseId: h.horse_id,
        modelProb: h.win_probability ?? h.confidence,
        marketProb: marketProbByHorse.get(h.horse_id) ?? null,
        isWinner: h.horse_id === winnerId,
      })),
    })
  }
  races.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const withMarket = races.filter((r) => r.horses.some((h) => h.marketProb != null))
  console.log(`${withMarket.length} / ${races.length} races have at least one recorded market price`)

  const splitIndex = Math.floor(withMarket.length * 0.7)
  const discovery = withMarket.slice(0, splitIndex)
  const holdout = withMarket.slice(splitIndex)
  console.log(`Discovery: ${discovery.length} races (earliest), Holdout: ${holdout.length} races (most recent, untouched until final check)\n`)

  function accuracyForAlpha(sample: RaceRecord[], alpha: number): number {
    let correct = 0
    for (const race of sample) {
      const scored = race.horses.map((h) => ({
        horseId: h.horseId,
        isWinner: h.isWinner,
        score: h.marketProb != null ? alpha * h.modelProb + (1 - alpha) * h.marketProb : h.modelProb,
      }))
      const pick = scored.reduce((a, b) => (b.score > a.score ? b : a))
      if (pick.isWinner) correct += 1
    }
    return sample.length ? correct / sample.length : 0
  }

  console.log('alpha (model weight) -> discovery winner accuracy')
  let bestAlpha = 1
  let bestAcc = -1
  for (const alpha of ALPHAS) {
    const acc = accuracyForAlpha(discovery, alpha)
    console.log(`  alpha=${alpha.toFixed(1)}  ${(acc * 100).toFixed(1)}%`)
    if (acc > bestAcc) {
      bestAcc = acc
      bestAlpha = alpha
    }
  }

  console.log(`\nBest discovery alpha: ${bestAlpha.toFixed(1)} (${(bestAcc * 100).toFixed(1)}% discovery accuracy)`)
  console.log('\nHoldout verification (untouched until now):')
  console.log(`  alpha=1.0 (model only):        ${(accuracyForAlpha(holdout, 1.0) * 100).toFixed(1)}%`)
  console.log(`  alpha=0.0 (market only):       ${(accuracyForAlpha(holdout, 0.0) * 100).toFixed(1)}%`)
  console.log(`  alpha=${bestAlpha.toFixed(1)} (best on discovery):  ${(accuracyForAlpha(holdout, bestAlpha) * 100).toFixed(1)}%`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
