import { DEFAULT_SIMULATION_FILTERS, type SimulationFilters, type SimulationMarket, type SimulationSettings } from './historical-simulator'

export const SIMULATION_PREFERENCES_KEY = 'paper-betting:simulator-preferences:v1'
export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = { startingBankroll: 500, method: 'flat', flatStake: 10, stakePercent: 1 }

export interface SimulationPreferences {
  schema: 1
  filters: Record<SimulationMarket, SimulationFilters>
  settings: SimulationSettings
  count: number
  sort: string
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function option<Value extends string | number>(value: unknown, fallback: Value, choices: readonly Value[]): Value {
  return choices.includes(value as Value) ? value as Value : fallback
}

function amount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100 ? value : fallback
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= 500 ? value : ''
}

function filters(value: unknown): SimulationFilters {
  const saved = record(value)
  const defaults = DEFAULT_SIMULATION_FILTERS
  const probabilities = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
  return {
    forecast: option<'latest' | 'history' | 'picks-history'>(saved.forecast, 'latest', ['latest', 'history', 'picks-history']),
    ...(saved.settlementOdds !== undefined ? { settlementOdds: option<'recorded' | 'tab'>(saved.settlementOdds, 'recorded', ['recorded', 'tab']) } : {}),
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : defaults.enabled,
    minReliability: option(saved.minReliability, defaults.minReliability, probabilities),
    minEdge: option(saved.minEdge, defaults.minEdge, [-100, -20, -15, -10, -5, -2, 0, 2, 5, 10, 15, 20]),
    minImplied: option(saved.minImplied, defaults.minImplied, probabilities),
    maxImplied: option(saved.maxImplied, defaults.maxImplied, [...probabilities.slice(1), 100]),
    minWin: option(saved.minWin, defaults.minWin, probabilities),
    minTop3: option(saved.minTop3, defaults.minTop3, probabilities),
    model: text(saved.model), rank: option(saved.rank, defaults.rank, [0, 1, 2, 3]),
    minOdds: option(saved.minOdds, defaults.minOdds, [0, 1.5, 2, 3, 5, 10]),
    maxOdds: option(saved.maxOdds, defaults.maxOdds, [0, 2, 3, 5, 10, 15, 20, 50]),
    source: option(saved.source, defaults.source, ['', 'tab', 'tab_decision', 'racing_com']),
    venue: text(saved.venue), maxField: option(saved.maxField, defaults.maxField, [0, 5, 7, 8, 9, 10, 12, 16]),
    minimumFieldSize: option(saved.minimumFieldSize, defaults.minimumFieldSize, [0, 5, 7, 8, 10, 12, 16]),
    inclusiveThresholds: typeof saved.inclusiveThresholds === 'boolean' ? saved.inclusiveThresholds : defaults.inclusiveThresholds,
    requireQualifiedWin: typeof saved.requireQualifiedWin === 'boolean' ? saved.requireQualifiedWin : defaults.requireQualifiedWin,
    minMinutesToJump: option(saved.minMinutesToJump, defaults.minMinutesToJump, [0, 1, 2, 5, 10, 15, 30, 60, 180]),
    maxMinutesToJump: option(saved.maxMinutesToJump, defaults.maxMinutesToJump, [0, 1, 2, 5, 10, 15, 30, 60, 180]),
    maxRank: option(saved.maxRank, defaults.maxRank, [0, 3]),
    positiveValueOnly: typeof saved.positiveValueOnly === 'boolean' ? saved.positiveValueOnly : defaults.positiveValueOnly,
    minTabMarketRank: option(saved.minTabMarketRank, 0, [0, 1, 2, 5]),
    maxTabMarketRank: option(saved.maxTabMarketRank, 0, [0, 1, 4]),
    onePerRace: typeof saved.onePerRace === 'boolean' ? saved.onePerRace : false,
  }
}

export function readSimulationPreferences(serialized: string | null): SimulationPreferences {
  let saved: Record<string, unknown> = {}
  try {
    const parsed = record(JSON.parse(serialized ?? 'null'))
    if (parsed.schema === 1) saved = parsed
  } catch {}
  const savedFilters = record(saved.filters)
  const settings = record(saved.settings)
  return {
    schema: 1,
    filters: { WIN: filters(savedFilters.WIN), PLACE: filters(savedFilters.PLACE) },
    settings: {
      startingBankroll: amount(settings.startingBankroll, DEFAULT_SIMULATION_SETTINGS.startingBankroll),
      flatStake: amount(settings.flatStake, DEFAULT_SIMULATION_SETTINGS.flatStake),
      method: option(settings.method, DEFAULT_SIMULATION_SETTINGS.method, ['flat', 'percent', 'kelly-0.10', 'kelly-0.25']),
      stakePercent: option(settings.stakePercent, DEFAULT_SIMULATION_SETTINGS.stakePercent, [0.5, 1, 2, 3, 5, 10]),
    },
    count: option(saved.count, 500, [100, 250, 500, 1000]),
    sort: option(saved.sort, 'start', ['start', 'profit', 'edge']),
  }
}