import { DEFAULT_SIMULATION_FILTERS, simulateBets, simulationCandidates, type SimulationFilters, type SimulationMarket, type SimulationRace, type SimulationSettings } from './historical-simulator'

export interface ProfitSuggestion {
  market: SimulationMarket
  filter: SimulationFilters | null
  eligible: boolean
  reason: string
  trainProfit: number
  holdoutProfit: number
  trainRaces: number
  holdoutRaces: number
  tested: number
  splitDate: string | null
}

export async function findProfitSuggestion(races: SimulationRace[], market: SimulationMarket, settings: SimulationSettings, cancelled = () => false): Promise<ProfitSuggestion> {
  const result: ProfitSuggestion = { market, filter: null, eligible: false, reason: 'At least 45 races across 6 racing days are required.', trainProfit: 0, holdoutProfit: 0, trainRaces: 0, holdoutRaces: 0, tested: 0, splitDate: null }
  const day = (race: SimulationRace) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne' }).format(new Date(race.start))
  const dated = races.map(race => ({ race, day: day(race) }))
  const days = [...new Set(dated.map(item => item.day))].sort()
  if (races.length < 45 || days.length < 6) return result
  const splitDate = days[Math.floor(days.length * 0.7)]
  result.splitDate = splitDate
  const training = simulationCandidates(dated.filter(item => item.day < splitDate).map(item => item.race)).filter(bet => bet.market === market && !bet.issue)
  const holdout = simulationCandidates(dated.filter(item => item.day >= splitDate).map(item => item.race)).filter(bet => bet.market === market && !bet.issue)
  const models = [...new Set(training.map(bet => bet.selection.model))].sort()
  const disabled = { ...DEFAULT_SIMULATION_FILTERS, enabled: false }
  let bestProfit = 0
  for (const model of models) {
    const modelTraining = training.filter(bet => bet.selection.model === model)
    for (const minEdge of [-10, -5, 0, 5, 10]) for (const probability of [0, 50, 60, 70]) for (const maxOdds of [3, 5, 10, 15]) for (const rank of [0, 1]) {
      if (cancelled()) return { ...result, eligible: false, reason: 'Search superseded by newer settings.' }
      const filter = { ...DEFAULT_SIMULATION_FILTERS, model, minEdge, maxOdds, rank, minTop3: market === 'PLACE' ? probability : 0, minWin: market === 'WIN' ? probability : 0 }
      const filters = market === 'WIN' ? { WIN: filter, PLACE: disabled } : { WIN: disabled, PLACE: filter }
      const summary = simulateBets(modelTraining, filters, settings).summaries[0]
      result.tested++
      if (summary && summary.races >= 30 && summary.profit > bestProfit) {
        bestProfit = summary.profit
        result.filter = filter
        result.trainProfit = summary.profit
        result.trainRaces = summary.races
      }
      if (result.tested % 32 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
  }
  if (!result.filter) return { ...result, reason: 'No positive training result with at least 30 selection races. Settings unchanged.' }
  const filters = market === 'WIN' ? { WIN: result.filter, PLACE: disabled } : { WIN: disabled, PLACE: result.filter }
  const validation = simulateBets(holdout, filters, settings).summaries[0]
  result.holdoutProfit = validation?.profit ?? 0
  result.holdoutRaces = validation?.races ?? 0
  result.eligible = result.holdoutRaces >= 15 && result.holdoutProfit > 0
  result.reason = result.eligible ? 'Highest training net profit in the tested grid; positive later holdout. Historical research, not a future-profit guarantee.' : 'Training winner did not pass a positive holdout with 15 selection races. Settings unchanged.'
  return result
}