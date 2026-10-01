import { PRODUCTION_MODEL_VERSION } from '../prediction-suite'
import { DEFAULT_THRESHOLDS } from './recommendation-engine'
import { DEFAULT_SIMULATION_FILTERS, type SimulationFilters, type SimulationMarket } from './historical-simulator'

export const MIN_RELIABILITY_FOR_AUTO_BET = 80
export const MIN_PLACE_PROBABILITY_FOR_AUTO_BET = 0.6

export function legacySimulationPreset(market: SimulationMarket): SimulationFilters {
  return {
    ...DEFAULT_SIMULATION_FILTERS, model: PRODUCTION_MODEL_VERSION, minTop3: market === 'PLACE' ? MIN_PLACE_PROBABILITY_FOR_AUTO_BET * 100 : 0,
    minEdge: DEFAULT_THRESHOLDS.minEdgePoints, maxOdds: DEFAULT_THRESHOLDS.maxOdds, inclusiveThresholds: true, positiveValueOnly: true,
    minimumFieldSize: market === 'PLACE' ? 8 : 0, rank: market === 'WIN' ? 1 : 0, maxRank: market === 'PLACE' ? 0 : 3,
    minReliability: market === 'WIN' ? MIN_RELIABILITY_FOR_AUTO_BET : 0, requireQualifiedWin: market === 'WIN',
    minMinutesToJump: DEFAULT_THRESHOLDS.minMinutesToJump, maxMinutesToJump: DEFAULT_THRESHOLDS.maxMinutesToJump,
  }
}