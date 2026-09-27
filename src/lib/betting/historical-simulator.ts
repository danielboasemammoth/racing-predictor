import { kellyFraction } from './kelly'

export type SimulationMarket = 'WIN' | 'PLACE'
export interface SimulationSelection {
  id: string
  horse: string
  model: string
  rank: number
  predictedAt: string
  winProbability: number | null
  top3Probability: number | null
  reliability: number | null
  winOdds: number | null
  placeOdds: number | null
  winSource: string
  placeSource: string
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
  minField: number
}

export const DEFAULT_SIMULATION_FILTERS: SimulationFilters = {
  enabled: true, minReliability: 0, minEdge: 0, minImplied: 0, maxImplied: 100,
  minWin: 0, minTop3: 50, model: '', rank: 0, minOdds: 0, maxOdds: 0,
  source: '', venue: '', minField: 0,
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
  source: string
  issue: string | null
  status: 'WON' | 'LOST' | 'REFUNDED' | 'EXCLUDED' | 'NO_BANKROLL'
  stake: number
  returned: number
  profit: number
}

export function simulationCandidates(races: SimulationRace[]): SimulationBet[] {
  return races.flatMap(race => race.selections.flatMap(selection => (['WIN', 'PLACE'] as const).map(market => {
    const probability = market === 'WIN' ? selection.winProbability : selection.top3Probability
    const odds = market === 'WIN' ? selection.winOdds : selection.placeOdds
    const implied = odds !== null && odds > 1 ? 1 / odds : null
    const issue = market === 'WIN' ? selection.winIssue : selection.placeIssue
    return {
      id: `${race.id}:${selection.id}:${selection.model}:${market}`, race, selection, market, probability, odds, implied,
      edge: probability !== null && implied !== null ? (probability - implied) * 100 : null,
      source: market === 'WIN' ? selection.winSource : selection.placeSource,
      issue: issue ?? (odds === null ? 'Missing recorded odds' : null),
      status: 'EXCLUDED' as const, stake: 0, returned: 0, profit: 0,
    }
  })))
}

export function matchesSimulationFilters(bet: SimulationBet, filter: SimulationFilters): boolean {
  const selection = bet.selection
  return filter.enabled
    && (!filter.model || selection.model === filter.model)
    && (!filter.rank || selection.rank === filter.rank)
    && (!filter.source || bet.source === filter.source)
    && (!filter.venue || bet.race.venue === filter.venue)
    && bet.race.fieldSize >= filter.minField
    && (!filter.minReliability || (selection.reliability !== null && selection.reliability >= filter.minReliability))
    && (filter.minEdge === -100 || (bet.edge !== null && bet.edge > filter.minEdge))
    && (!filter.minTop3 || (selection.top3Probability !== null && selection.top3Probability * 100 > filter.minTop3))
    && (!filter.minWin || (selection.winProbability !== null && selection.winProbability * 100 > filter.minWin))
    && (!filter.minImplied || (bet.implied !== null && bet.implied * 100 >= filter.minImplied))
    && (filter.maxImplied === 100 || (bet.implied !== null && bet.implied * 100 <= filter.maxImplied))
    && (!filter.minOdds || (bet.odds !== null && bet.odds >= filter.minOdds))
    && (!filter.maxOdds || (bet.odds !== null && bet.odds <= filter.maxOdds))
}

export function simulateBets(candidates: SimulationBet[], filters: Record<SimulationMarket, SimulationFilters>, settings: SimulationSettings) {
  const starting = Number.isFinite(settings.startingBankroll) ? Math.max(0, Math.round(settings.startingBankroll * 100)) : 0
  const bets = candidates.filter(bet => matchesSimulationFilters(bet, filters[bet.market])).map(bet => ({ ...bet }))
  const models = [...new Set(bets.map(bet => bet.selection.model))].sort()
  const summaries = models.map(model => {
    const portfolio = bets.filter(bet => bet.selection.model === model).sort((left, right) => left.race.start.localeCompare(right.race.start) || left.id.localeCompare(right.id))
    let cash = starting
    let peak = starting
    let maxDrawdown = 0
    const pending: Array<{ time: number; principal: number; returned: number }> = []
    function settle(until: number) {
      pending.sort((left, right) => left.time - right.time)
      while (pending.length && pending[0].time <= until) {
        const settledAt = pending[0].time
        do {
          cash += pending.shift()!.returned
        } while (pending.length && pending[0].time === settledAt)
        const equity = cash + pending.reduce((total, open) => total + open.principal, 0)
        peak = Math.max(peak, equity)
        maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0)
      }
    }
    for (let offset = 0; offset < portfolio.length;) {
      const time = Date.parse(portfolio[offset].race.start)
      settle(time)
      let end = offset + 1
      while (end < portfolio.length && Date.parse(portfolio[end].race.start) === time) end++
      const group = portfolio.slice(offset, end)
      const desired = group.map(bet => {
        if (bet.issue || bet.odds === null) return 0
        let raw = settings.flatStake * 100
        if (settings.method === 'percent') raw = cash * settings.stakePercent / 100
        if (settings.method.startsWith('kelly')) raw = bet.probability === null ? 0 : cash * Math.min(0.05, kellyFraction(bet.odds, bet.probability) * (settings.method === 'kelly-0.10' ? 0.1 : 0.25))
        return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
      })
      const requested = desired.reduce((total, amount) => total + amount, 0)
      const scale = requested > cash ? cash / requested : 1
      for (const [index, bet] of group.entries()) {
        if (bet.issue || bet.odds === null) continue
        const stake = Math.floor(desired[index] * scale)
        if (stake <= 0) { bet.status = 'NO_BANKROLL'; continue }
        bet.status = bet.selection.scratched ? 'REFUNDED' : (bet.selection.position !== null && bet.selection.position <= (bet.market === 'WIN' ? 1 : 3)) ? 'WON' : 'LOST'
        const returned = bet.status === 'REFUNDED' ? stake : bet.status === 'WON' ? Math.round(stake * bet.odds) : 0
        bet.stake = stake / 100
        bet.returned = returned / 100
        bet.profit = (returned - stake) / 100
        cash -= stake
        const observed = bet.race.settledAt ? Date.parse(bet.race.settledAt) : Infinity
        pending.push({ time: observed > time ? observed : Infinity, principal: stake, returned })
      }
      offset = end
    }
    settle(Infinity)
    const decided = portfolio.filter(bet => bet.status === 'WON' || bet.status === 'LOST')
    const staked = decided.reduce((total, bet) => total + bet.stake, 0)
    const profit = decided.reduce((total, bet) => total + bet.profit, 0)
    return { model, bets: decided.length, races: new Set(decided.map(bet => bet.race.id)).size,
      wins: decided.filter(bet => bet.status === 'WON').length, staked, profit,
      roi: staked ? profit / staked * 100 : null, bankroll: cash / 100, maxDrawdown: maxDrawdown * 100,
      excluded: portfolio.filter(bet => bet.status === 'EXCLUDED').length,
      refunded: portfolio.filter(bet => bet.status === 'REFUNDED').length,
      unfunded: portfolio.filter(bet => bet.status === 'NO_BANKROLL').length }
  })
  return { bets, summaries }
}