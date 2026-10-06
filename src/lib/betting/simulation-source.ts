import type { PredictedHorse } from '../types'
import type { SimulationRace, SimulationSelection } from './historical-simulator'
import { isSimulationDecisionQuote, isSimulationTabQuote } from './historical-simulator'
import { normalizeHorseName } from '../paper-betting/fundamentals-bridge'
import type { TabPrice } from '../paper-betting/internal-tab-odds'
import type { SimulationEvidence } from './simulation-evidence'
import type { SimulationDecision } from './simulation-decision'
import { harvillePlaceProbabilities } from './harville'

export interface SimulationSource {
  id: string
  start: string
  settledAt: string | null
  venue: string
  state: string
  number: number
  entries: Array<{ horse_id: string; position: number | null; status: string }>
  forecasts: Array<{ id: string; model: string; predictedAt: string; createdAt: string; podium: PredictedHorse[]; allHorses?: PredictedHorse[]; evidence?: SimulationEvidence | null; field: string[] }>
  decisions?: SimulationDecision[]
  history?: Array<{
    forecast: SimulationSource['forecasts'][number]
    horseId: string
    winProbability: number
    top3Probability: number
    observedAt: string
    provenance: 'home-snapshot' | 'pre-race-recovery'
  }>
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
    const podium = (forecast.podium ?? []).slice(0, 3)
    const evidence = forecast.evidence
    const verifiedEvidence = evidence && matchingField && evidence.predictionId === forecast.id && evidence.horseId === podium[0]?.horse_id
      && Number.isFinite(evidence.reliability) && evidence.reliability >= 0 && evidence.reliability <= 100 && typeof evidence.qualifiedWin === 'boolean'
      && Date.parse(evidence.capturedAt) >= Date.parse(forecast.createdAt) && Date.parse(evidence.capturedAt) >= Date.parse(forecast.predictedAt)
      && Date.parse(evidence.capturedAt) < Date.parse(source.start) ? evidence : null
    const remaining = (forecast.allHorses ?? []).filter(horse => !podium.some(top => top.horse_id === horse.horse_id)).sort((left, right) => left.predicted_position - right.predicted_position)
    const fullField = matchingField && forecast.allHorses?.length === field.size && new Set(forecast.allHorses.map(horse => horse.horse_id)).size === field.size && forecast.allHorses.every(horse => field.has(horse.horse_id))
    const winField = (forecast.allHorses ?? []).map(horse => probability(horse.win_probability))
    const winSum = winField.reduce<number>((total, value) => total + (value ?? 0), 0)
    const top2 = fullField && winField.every(value => value !== null) && Math.abs(winSum - 1) < 0.001
      ? harvillePlaceProbabilities(winField.map(value => value! / winSum), 2) : []
    for (const [index, horse] of [...podium, ...remaining].entries()) {
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
        top2Probability: top2[forecast.allHorses?.findIndex(runner => runner.horse_id === horse.horse_id) ?? -1] ?? null,
        reliability: verifiedEvidence?.horseId === horse.horse_id ? verifiedEvidence.reliability : null,
        qualifiedWin: verifiedEvidence ? verifiedEvidence.horseId === horse.horse_id && verifiedEvidence.qualifiedWin : null,
        evaluatedAt: verifiedEvidence?.capturedAt ?? null, fullField: !!fullField,
        winOdds: tabWin ?? odds(horse.win_odds_source === 'tab' ? undefined : horse.win_odds),
        placeOdds: tabPlace ?? odds(horse.place_odds_source === 'tab' ? undefined : horse.place_odds),
        winSource: tabWin !== null ? 'tab' : horse.win_odds_source ?? 'racing_com',
        placeSource: tabPlace !== null ? 'tab' : horse.place_odds_source ?? 'racing_com',
        winProvider: tabWin !== null ? 'TAB' : horse.win_odds_provider ?? null,
        placeProvider: tabPlace !== null ? 'TAB' : horse.place_odds_provider ?? null,
        tabQuotedAt: tab?.quotedAt ?? null, tabCapturedAt: tab?.capturedAt ?? null,
        position: entry?.position ?? null, scratched: entry?.status === 'scratched',
        winIssue: entry?.status === 'scratched' ? null : issue,
        placeIssue: entry?.status === 'scratched' ? null : issue ?? (active.length < 8 ? 'Top-three probability does not match paid places' : !places.includes(2) || !places.includes(3) ? 'Incomplete place results' : null),
      })
    }
  }
  const decisionSelections: SimulationSelection[] = []
  const decisionModels = new Set<string>()
  let tabPlaceResearch: SimulationRace['tabPlaceResearch']
  for (const decision of source.decisions ?? []) {
    const forecast = decision.forecast
    if (decision.schema !== 1 || decision.raceId !== source.id || Date.parse(decision.start) !== Date.parse(source.start)
      || !forecast || decisionModels.has(forecast.model) || !forecast.evidence
      || forecast.evidence.capturedAt !== decision.capturedAt || forecast.evidence.predictionId !== forecast.id
      || !(Date.parse(forecast.createdAt) <= Date.parse(decision.capturedAt))
      || !(Date.parse(forecast.predictedAt) <= Date.parse(decision.capturedAt))) continue
    decisionModels.add(forecast.model)
    if (decision.tabPlaceResearch?.model === forecast.model) tabPlaceResearch = decision.tabPlaceResearch
    const frozen = buildSimulationRace({ ...source, forecasts: [forecast], decisions: undefined, history: undefined })
    for (const selection of frozen.selections) {
      const price = decision.prices?.[selection.id]
      const valid = price && isSimulationDecisionQuote(source.start, decision.capturedAt, price.quotedAt, price.capturedAt)
      const terms = price?.placeTerms
      const verifiedTerms = !!(valid && terms && terms.source === 'TAB' && terms.product === 'fixed-place'
        && [2, 3].includes(terms.paidPlaces) && terms.fieldSize === field.size && terms.capturedAt === price.capturedAt)
      const placeProbability = verifiedTerms ? terms!.paidPlaces === 2 ? selection.top2Probability : selection.top3Probability : undefined
      const placeIssue = verifiedTerms ? selection.winIssue
        ?? (placeProbability == null ? 'Missing paid-place probability' : null)
        ?? (Array.from({ length: terms!.paidPlaces }, (_, index) => index + 1).some(position => !places.includes(position)) ? 'Incomplete place results' : null)
        : selection.placeIssue
      decisionSelections.push({ ...selection, evaluatedAt: decision.capturedAt,
        placeProbability, placePaidPlaces: verifiedTerms ? terms!.paidPlaces : undefined, placeTermsVerified: verifiedTerms,
        winOdds: valid ? odds(price.win) : null, placeOdds: valid ? odds(price.place) : null,
        winSource: 'tab_decision', placeSource: 'tab_decision', tabQuotedAt: price?.quotedAt ?? null, tabCapturedAt: price?.capturedAt ?? null,
        winProvider: 'TAB', placeProvider: 'TAB',
        winIssue: selection.winIssue ?? (!valid ? 'Missing or stale TAB decision quote' : null),
        placeIssue: placeIssue ?? (!valid ? 'Missing or stale TAB decision quote' : null) })
    }
  }
  const historySelections: SimulationSelection[] = []
  const historyHorses = new Set<string>()
  for (const pick of source.history ?? []) {
    if (historyHorses.has(pick.horseId) || !(Date.parse(pick.observedAt) < Date.parse(source.start))
      || !(Date.parse(pick.observedAt) >= Date.parse(pick.forecast.createdAt))
      || !(Date.parse(pick.observedAt) >= Date.parse(pick.forecast.predictedAt))) continue
    const frozen = buildSimulationRace({ ...source, forecasts: [pick.forecast], decisions: undefined, history: undefined })
    const selection = frozen.selections.find(selection => selection.id === pick.horseId)
    if (!selection) continue
    historyHorses.add(pick.horseId)
    historySelections.push({ ...selection, forecastBasis: 'history', predictionId: pick.forecast.id,
      winProbability: probability(pick.winProbability), top3Probability: probability(pick.top3Probability),
      historyProvenance: pick.provenance, historyObservedAt: pick.observedAt })
  }
  return { id: source.id, start: source.start, settledAt: source.settledAt, venue: source.venue, state: source.state, number: source.number, fieldSize: active.length, selections, decisionSelections, historySelections, tabPlaceResearch }
}