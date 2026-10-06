import { kellyFraction } from './kelly'
import { racingComProviderLabel } from './racing-com-odds'
import type { TabPlaceTrial } from './tab-place-research'

export type SimulationMarket = 'WIN' | 'PLACE'
export interface SimulationSelection {
  id: string
  horse: string
  model: string
  rank: number
  predictedAt: string
  winProbability: number | null
  top3Probability: number | null
  top2Probability?: number | null
  placeProbability?: number | null
  placePaidPlaces?: 2 | 3
  placeTermsVerified?: boolean
  reliability: number | null
  qualifiedWin?: boolean | null
  fullField?: boolean
  evaluatedAt?: string | null
  winOdds: number | null
  placeOdds: number | null
  winSource: string
  placeSource: string
  winProvider?: string | null
  placeProvider?: string | null
  tabQuotedAt?: string | null
  tabCapturedAt?: string | null
  position: number | null
  scratched: boolean
  winIssue: string | null
  placeIssue: string | null
}

export interface SimulationRace {
  id: string
  start: string
  settledAt: string | null
  venue: string
  state: string
  number: number
  fieldSize: number
  selections: SimulationSelection[]
  decisionSelections?: SimulationSelection[]
  tabPlaceResearch?: TabPlaceTrial
}

export interface SimulationDataset {
  schema: 1
  generatedAt: string
  races: SimulationRace[]
  models: string[]
}

export interface SimulationFilters {
  enabled: boolean
  minReliability: number
  minEdge: number
  minImplied: number
  maxImplied: number
  minWin: number
  minTop3: number
  model: string
  rank: number
  minOdds: number
  maxOdds: number
  source: string
  venue: string
  maxField: number
  minimumFieldSize: number
  inclusiveThresholds: boolean
  requireQualifiedWin: boolean
  minMinutesToJump: number
  maxMinutesToJump: number
  maxRank: number
  positiveValueOnly: boolean
  minTabMarketRank?: number
  maxTabMarketRank?: number
  onePerRace?: boolean
}

export const DEFAULT_SIMULATION_FILTERS: SimulationFilters = {
  enabled: true, minReliability: 0, minEdge: 0, minImplied: 0, maxImplied: 100,
  minWin: 0, minTop3: 50, model: '', rank: 0, minOdds: 0, maxOdds: 0,
  source: '', venue: '', maxField: 0, minimumFieldSize: 0, inclusiveThresholds: false,
  requireQualifiedWin: false, minMinutesToJump: 0, maxMinutesToJump: 0, maxRank: 3, positiveValueOnly: false,
  minTabMarketRank: 0, maxTabMarketRank: 0, onePerRace: false,
}

export interface SimulationSettings {
  startingBankroll: number
  method: 'flat' | 'percent' | 'kelly-0.10' | 'kelly-0.25'
  flatStake: number
  stakePercent: number
}

export interface SimulationBet {
  id: string
  race: SimulationRace
  selection: SimulationSelection
  market: SimulationMarket
  probability: number | null
  odds: number | null
  implied: number | null
  edge: number | null
  tabMarketRank?: number | null
  source: string
  issue: string | null
  status: 'WON' | 'LOST' | 'REFUNDED' | 'EXCLUDED' | 'NO_BANKROLL'
  stake: number
  returned: number
  profit: number
}

export function isSimulationTabQuote(start: string, quotedAt?: string | null, capturedAt?: string | null): boolean {
  const raceTime = Date.parse(start)
  const quoteTime = Date.parse(quotedAt ?? '')
  const captureTime = Date.parse(capturedAt ?? '')
  return Number.isFinite(raceTime) && Number.isFinite(quoteTime) && Number.isFinite(captureTime)
    && quoteTime >= raceTime - 10 * 60_000 && captureTime <= raceTime
    && quoteTime <= captureTime && captureTime - quoteTime <= 2 * 60_000
}

export function isSimulationDecisionQuote(start: string, evaluatedAt?: string | null, quotedAt?: string | null, capturedAt?: string | null): boolean {
  const decision = Date.parse(evaluatedAt ?? '')
  const quote = Date.parse(quotedAt ?? '')
  const capture = Date.parse(capturedAt ?? '')
  const minutesToJump = (Date.parse(start) - decision) / 60_000
  return minutesToJump >= 1 && minutesToJump <= 180 && quote <= capture && capture <= decision
    && decision - quote <= 2 * 60_000
}

export function simulationTabMarketRank(race: SimulationRace, selection: SimulationSelection, source: string): number | null {
  if (source !== 'tab' && source !== 'tab_decision') return null
  const field = (source === 'tab_decision' ? race.decisionSelections ?? [] : race.selections).filter(runner => runner.model === selection.model)
  if (field.length !== race.fieldSize || new Set(field.map(runner => runner.id)).size !== field.length
    || field.some(runner => !runner.fullField || runner.scratched || runner.winSource !== source
      || runner.winOdds === null || !Number.isFinite(runner.winOdds) || runner.winOdds <= 1
      || Date.parse(runner.tabCapturedAt ?? '') !== Date.parse(selection.tabCapturedAt ?? '')
      || runner.evaluatedAt !== selection.evaluatedAt
      || !(source === 'tab_decision'
        ? isSimulationDecisionQuote(race.start, runner.evaluatedAt, runner.tabQuotedAt, runner.tabCapturedAt)
        : isSimulationTabQuote(race.start, runner.tabQuotedAt, runner.tabCapturedAt)))) return null
  return selection.winOdds === null ? null : 1 + field.filter(runner => runner.winOdds! < selection.winOdds!).length
}

export function simulationCandidates(races: SimulationRace[]): SimulationBet[] {
  return races.flatMap(race => [...race.selections, ...(race.decisionSelections ?? [])].flatMap(selection => (['WIN', 'PLACE'] as const).map(market => {
    const probability = market === 'WIN' ? selection.winProbability : selection.placeTermsVerified ? selection.placeProbability ?? null : selection.top3Probability
    const odds = market === 'WIN' ? selection.winOdds : selection.placeOdds
    const implied = odds !== null && odds > 1 ? 1 / odds : null
    const source = market === 'WIN' ? selection.winSource : selection.placeSource
    const issue = (market === 'WIN' ? selection.winIssue : selection.placeIssue)
      ?? (market === 'PLACE' && selection.placeTermsVerified && probability === null ? 'Missing paid-place probability' : null)
      ?? (source === 'tab_decision' && (!isSimulationDecisionQuote(race.start, selection.evaluatedAt, selection.tabQuotedAt, selection.tabCapturedAt)
        || !(Date.parse(selection.predictedAt) <= Date.parse(selection.evaluatedAt ?? ''))) ? 'TAB quote not verified at decision time' : null)
      ?? (source === 'tab' && !isSimulationTabQuote(race.start, selection.tabQuotedAt, selection.tabCapturedAt) ? 'TAB quote not verified near race start' : null)
    return {
      id: `${race.id}:${selection.id}:${selection.model}:${market}${source === 'tab_decision' ? ':decision' : ''}`, race, selection, market, probability, odds, implied,
      edge: probability !== null && implied !== null ? (probability - implied) * 100 : null,
      tabMarketRank: simulationTabMarketRank(race, selection, source),
      source,
      issue: issue ?? (odds === null ? 'Missing recorded odds' : null),
      status: 'EXCLUDED' as const, stake: 0, returned: 0, profit: 0,
    }
  })))
}

export function matchesSimulationFilters(bet: SimulationBet, filter: SimulationFilters): boolean {
  const selection = bet.selection
  const passes = (value: number | null, threshold: number) => value !== null && (filter.inclusiveThresholds ? value >= threshold : value > threshold)
  const evaluatedAt = selection.evaluatedAt ?? (bet.source === 'tab' ? selection.tabCapturedAt : null)
  const minutesToJump = (Date.parse(bet.race.start) - Date.parse(evaluatedAt ?? '')) / 60_000
  return filter.enabled
    && (bet.source !== 'tab_decision' || filter.source === 'tab_decision')
    && (!filter.model || selection.model === filter.model)
    && (!filter.rank || selection.rank === filter.rank)
    && (filter.maxRank ? selection.rank <= filter.maxRank : selection.fullField === true)
    && (!filter.source || bet.source === filter.source)
    && (!filter.minTabMarketRank || (bet.tabMarketRank != null && bet.tabMarketRank >= filter.minTabMarketRank))
    && (!filter.maxTabMarketRank || (bet.tabMarketRank != null && bet.tabMarketRank <= filter.maxTabMarketRank))
    && (!filter.venue || bet.race.venue === filter.venue)
    && (!filter.maxField || bet.race.fieldSize < filter.maxField)
    && (!filter.minimumFieldSize || bet.race.fieldSize >= filter.minimumFieldSize)
    && (!filter.requireQualifiedWin || selection.qualifiedWin === true)
    && (!filter.positiveValueOnly || (bet.probability !== null && bet.probability > 0 && bet.probability < 1 && bet.odds !== null && bet.odds > 1 && bet.probability * bet.odds > 1))
    && (!filter.minMinutesToJump || (Number.isFinite(minutesToJump) && minutesToJump >= filter.minMinutesToJump))
    && (!filter.maxMinutesToJump || (Number.isFinite(minutesToJump) && minutesToJump <= filter.maxMinutesToJump))
    && (!filter.minReliability || (selection.reliability !== null && selection.reliability >= filter.minReliability))
    && (filter.minEdge === -100 || passes(bet.edge, filter.minEdge))
    && (!filter.minTop3 || passes(selection.top3Probability === null ? null : selection.top3Probability * 100, filter.minTop3))
    && (!filter.minWin || passes(selection.winProbability === null ? null : selection.winProbability * 100, filter.minWin))
    && (!filter.minImplied || (bet.implied !== null && bet.implied * 100 >= filter.minImplied))
    && (filter.maxImplied === 100 || (bet.implied !== null && bet.implied * 100 <= filter.maxImplied))
    && (!filter.minOdds || (bet.odds !== null && bet.odds >= filter.minOdds))
    && (!filter.maxOdds || (bet.odds !== null && bet.odds <= filter.maxOdds))
}

export function simulateBets(candidates: SimulationBet[], filters: Record<SimulationMarket, SimulationFilters>, settings: SimulationSettings) {
  const starting = Number.isFinite(settings.startingBankroll) ? Math.max(0, Math.round(settings.startingBankroll * 100)) : 0
  const matched = candidates.filter(bet => matchesSimulationFilters(bet, filters[bet.market])).map(bet => ({ ...bet }))
  const winners = new Map<string, SimulationBet>()
  const value = (bet: SimulationBet) => (bet.probability ?? 0) * (bet.odds ?? 0) - 1
  for (const bet of matched) {
    if (!filters[bet.market].onePerRace || bet.issue || bet.selection.scratched) continue
    const key = `${bet.race.id}:${bet.selection.model}:${bet.market}`
    const current = winners.get(key)
    if (!current || value(bet) > value(current) || (value(bet) === value(current) && bet.id < current.id)) winners.set(key, bet)
  }
  const bets = matched.filter(bet => !filters[bet.market].onePerRace || bet.issue || bet.selection.scratched
    || winners.get(`${bet.race.id}:${bet.selection.model}:${bet.market}`) === bet)
  const models = [...new Set(bets.map(bet => bet.selection.model))].sort()
  const summaries = models.map(model => {
    const portfolio = bets.filter(bet => bet.selection.model === model).sort((left, right) => left.race.start.localeCompare(right.race.start) || left.race.id.localeCompare(right.race.id) || left.id.localeCompare(right.id))
    let cash = starting
    let peak = starting
    let maxDrawdown = 0
    for (let offset = 0; offset < portfolio.length;) {
      let end = offset + 1
      while (end < portfolio.length && portfolio[end].race.id === portfolio[offset].race.id) end++
      const group = portfolio.slice(offset, end)
      const desired = group.map(bet => {
        if (bet.issue || bet.odds === null) return 0
        let raw = Math.round(settings.flatStake * 100)
        if (settings.method === 'percent') raw = cash * settings.stakePercent / 100
        if (settings.method.startsWith('kelly')) raw = bet.probability === null ? 0 : cash * Math.min(0.05, kellyFraction(bet.odds, bet.probability) * (settings.method === 'kelly-0.10' ? 0.1 : 0.25))
        return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
      })
      const requested = desired.reduce((total, amount) => total + amount, 0)
      const scale = requested > cash ? cash / requested : 1
      let raceReturns = 0
      for (const [index, bet] of group.entries()) {
        if (bet.issue || bet.odds === null) continue
        const stake = Math.floor(desired[index] * scale)
        if (stake <= 0) { bet.status = 'NO_BANKROLL'; continue }
        const paidPlaces = bet.selection.placeTermsVerified ? bet.selection.placePaidPlaces ?? 3 : 3
        bet.status = bet.selection.scratched ? 'REFUNDED' : (bet.selection.position !== null && bet.selection.position <= (bet.market === 'WIN' ? 1 : paidPlaces)) ? 'WON' : 'LOST'
        const returned = bet.status === 'REFUNDED' ? stake : bet.status === 'WON' ? Math.round(stake * bet.odds) : 0
        bet.stake = stake / 100
        bet.returned = returned / 100
        bet.profit = (returned - stake) / 100
        cash -= stake
        raceReturns += returned
      }
      cash += raceReturns
      peak = Math.max(peak, cash)
      maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - cash) / peak : 0)
      offset = end
    }
    const decided = portfolio.filter(bet => bet.status === 'WON' || bet.status === 'LOST')
    const staked = decided.reduce((total, bet) => total + Math.round(bet.stake * 100), 0) / 100
    const profit = decided.reduce((total, bet) => total + Math.round(bet.profit * 100), 0) / 100
    return { model, bets: decided.length, races: new Set(decided.map(bet => bet.race.id)).size,
      wins: decided.filter(bet => bet.status === 'WON').length, staked, profit,
      roi: staked ? profit / staked * 100 : null, bankroll: cash / 100, maxDrawdown: maxDrawdown * 100,
      excluded: portfolio.filter(bet => bet.status === 'EXCLUDED').length,
      refunded: portfolio.filter(bet => bet.status === 'REFUNDED').length,
      unfunded: portfolio.filter(bet => bet.status === 'NO_BANKROLL').length }
  })
  return { bets, summaries }
}

export function simulationBetProvider(bet: Pick<SimulationBet, 'source' | 'market' | 'selection'>): string {
  if (bet.source === 'tab' || bet.source === 'tab_decision') return 'TAB'
  const provider = bet.market === 'WIN' ? bet.selection.winProvider : bet.selection.placeProvider
  return racingComProviderLabel(provider)
}