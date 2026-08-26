/**
 * Baseline comparisons (spec Phase 29): the model must be judged against simple, meaningful
 * baselines, not just its own headline numbers. "Favourite" here means the lowest-priced runner
 * in Racing.com's own recorded odds - not a confirmed TAB/Betfair favourite (no market access).
 */
import { flatStakeReport, type FlatStakeReport } from './roi-analysis'

export interface BaselineRace {
  favouritePrice: number | null
  favouriteWon: boolean
  modelPickPrice: number | null
  modelPickWon: boolean
}

export interface BaselineComparison {
  favourite: FlatStakeReport
  model: FlatStakeReport
}

export function compareBaselines(races: BaselineRace[]): BaselineComparison {
  const favouriteBets = races
    .filter((race): race is BaselineRace & { favouritePrice: number } => race.favouritePrice !== null)
    .map((race) => ({ won: race.favouriteWon, odds: race.favouritePrice }))
  const modelBets = races
    .filter((race): race is BaselineRace & { modelPickPrice: number } => race.modelPickPrice !== null)
    .map((race) => ({ won: race.modelPickWon, odds: race.modelPickPrice }))
  return {
    favourite: flatStakeReport(favouriteBets),
    model: flatStakeReport(modelBets),
  }
}
