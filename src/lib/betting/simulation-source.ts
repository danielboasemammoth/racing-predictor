import type { PredictedHorse } from '../types'
import type { SimulationRace, SimulationSelection } from './historical-simulator'
import { isSimulationTabQuote } from './historical-simulator'
import { normalizeHorseName } from '../paper-betting/fundamentals-bridge'
import type { TabPrice } from '../paper-betting/internal-tab-odds'

export interface SimulationSource {
  id: string
  start: string
  settledAt: string | null
  venue: string
  state: string
  number: number
  entries: Array<{ horse_id: string; position: number | null; status: string }>
  forecasts: Array<{ id: string; model: string; predictedAt: string; createdAt: string; podium: PredictedHorse[]; field: string[] }>
}

function probability(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

function odds(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 1 ? value : null
}

export function buildSimulationRace(source: SimulationSource, tabPrices: Map<string, TabPrice> = new Map()): SimulationRace {
  const active = source.entries.filter(entry => entry.status !== 'scratched')
  const field = new Set(active.map(entry => entry.horse_id))
  const finishers = active.filter(entry => entry.position !== null && entry.position > 0)
  const places = finishers.map(entry => entry.position)
  const ambiguous = new Set(places).size !== places.length
  const missingResults = !places.includes(1) || active.some(entry => entry.status !== 'did_not_finish' && (entry.position === null || entry.position < 1))
  const selections: SimulationSelection[] = []
  const models = new Set<string>()
  for (const forecast of [...source.forecasts].sort((left, right) => right.predictedAt.localeCompare(left.predictedAt) || right.id.localeCompare(left.id))) {
    if (models.has(forecast.model) || forecast.model.includes('retrospective')
      || !(Date.parse(forecast.predictedAt) < Date.parse(source.start))
      || !(Date.parse(forecast.createdAt) < Date.parse(source.start))) continue
    models.add(forecast.model)
    const matchingField = Array.isArray(forecast.field) && forecast.field.length === field.size && forecast.field.every(horseId => field.has(horseId)) && new Set(forecast.field).size === field.size
    const seen = new Set<string>()
    for (const [index, horse] of (forecast.podium ?? []).slice(0, 3).entries()) {
      if (!horse.horse_id || seen.has(horse.horse_id)) continue
      seen.add(horse.horse_id)
      const candidate = tabPrices.get(normalizeHorseName(horse.horse_name))
      const tab = candidate && isSimulationTabQuote(source.start, candidate.quotedAt, candidate.capturedAt) ? candidate : undefined
      const tabWin = odds(tab?.win)
      const tabPlace = odds(tab?.place)
      const entry = source.entries.find(item => item.horse_id === horse.horse_id)
      const issue = !entry ? 'Runner missing from results' : ambiguous ? 'Ambiguous or dead-heat result'
        : missingResults ? 'Incomplete results' : !matchingField ? 'Changed field; deductions unverified' : null
      selections.push({
        id: horse.horse_id, horse: horse.horse_name, model: forecast.model, rank: index + 1,
        predictedAt: forecast.predictedAt, winProbability: probability(horse.win_probability), top3Probability: probability(horse.top3_probability),
        reliability: null,
        winOdds: tabWin ?? odds(horse.win_odds_source === 'tab' ? undefined : horse.win_odds),
        placeOdds: tabPlace ?? odds(horse.place_odds_source === 'tab' ? undefined : horse.place_odds),
        winSource: tabWin !== null ? 'tab' : horse.win_odds_source ?? 'racing_com',
        placeSource: tabPlace !== null ? 'tab' : horse.place_odds_source ?? 'racing_com',
        tabQuotedAt: tab?.quotedAt ?? null, tabCapturedAt: tab?.capturedAt ?? null,
        position: entry?.position ?? null, scratched: entry?.status === 'scratched',
        winIssue: entry?.status === 'scratched' ? null : issue,
        placeIssue: entry?.status === 'scratched' ? null : issue ?? (active.length < 8 ? 'Top-three probability does not match paid places' : !places.includes(2) || !places.includes(3) ? 'Incomplete place results' : null),
      })
    }
  }
  return { id: source.id, start: source.start, settledAt: source.settledAt, venue: source.venue, state: source.state, number: source.number, fieldSize: active.length, selections }
}