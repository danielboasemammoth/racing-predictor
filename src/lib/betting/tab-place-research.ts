import { melbourneDateKey } from '../daily-picks'
import { brierScore, bucketCalibration, logLoss } from './calibration'
import { DEFAULT_SIMULATION_FILTERS, simulateBets, simulationCandidates, type SimulationBet, type SimulationRace } from './historical-simulator'
import { runPlaceCalibrationStudy, type PlaceStudyRace } from './place-calibration-study'

export const TAB_PLACE_TRIAL = Object.freeze({
  version: 'tab-place-value-v1', model: 'v6-market-blend', source: 'tab_decision',
  minimumEdgePoints: 5, minimumExpectedReturn: 0.05, maximumOdds: 15,
  startingBankroll: 500, flatStake: 1, onePerRace: true, shrinkageStrength: 0,
  minimumReviewRaces: 300, minimumReviewDays: 30,
} as const)
export type TabPlaceTrial = typeof TAB_PLACE_TRIAL

export function isTabPlaceTrial(value: unknown): value is TabPlaceTrial {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(TAB_PLACE_TRIAL).every(([key, expected]) => (value as Record<string, unknown>)[key] === expected)
}

function eligibleField(race: SimulationRace, bets: SimulationBet[]) {
  const paidPlaces = race.fieldSize === 7 ? 2 : race.fieldSize === 8 ? 3 : null
  if (!paidPlaces || bets.length !== race.fieldSize || new Set(bets.map(bet => bet.selection.id)).size !== race.fieldSize) return false
  return bets.every(bet => bet.selection.fullField && !bet.selection.scratched && !bet.issue && bet.tabMarketRank != null
    && bet.selection.placeTermsVerified && bet.selection.placePaidPlaces === paidPlaces
    && bet.probability !== null && Number.isFinite(bet.probability) && bet.probability > 0 && bet.probability < 1
    && bet.odds !== null && Number.isFinite(bet.odds) && bet.odds > 1)
    && Math.abs(bets.reduce((total, bet) => total + bet.probability!, 0) - paidPlaces) < 0.001
}

export function tabPlaceCalibration(races: SimulationRace[]) {
  const candidates = simulationCandidates(races.map(race => ({ ...race, selections: [] }))).filter(bet => bet.market === 'PLACE' && bet.source === 'tab_decision' && bet.selection.model === TAB_PLACE_TRIAL.model)
  return ([7, 8] as const).map(fieldSize => {
    const samples: PlaceStudyRace[] = []
    for (const race of races.filter(race => race.fieldSize === fieldSize)) {
      const bets = candidates.filter(bet => bet.race.id === race.id)
      if (!eligibleField(race, bets)) continue
      samples.push({ raceId: race.id, startTime: race.start, paidPlaces: fieldSize === 7 ? 2 : 3,
        runners: bets.map(bet => ({ horseId: bet.selection.id, probability: bet.probability!, odds: bet.odds,
          placed: bet.selection.position !== null && bet.selection.position <= bet.selection.placePaidPlaces! })) })
    }
    const days = new Set(samples.map(sample => melbourneDateKey(sample.startTime))).size
    const study = samples.length >= 150 && days >= 5 ? runPlaceCalibrationStudy(samples) : null
    return { fieldSize, races: samples.length, days, study, status: study ? 'Historical candidate only; separate prospective version required' : 'Insufficient verified TAB samples (150 races and five days required)' }
  })
}

function summarizeBets(bets: SimulationBet[]) {
  const ordered = bets.filter(bet => bet.status === 'WON' || bet.status === 'LOST').sort((left, right) => left.race.start.localeCompare(right.race.start) || left.id.localeCompare(right.id))
  const daily = new Map<string, number>()
  let losingStreak = 0
  let longestLosingStreak = 0
  let balance: number = TAB_PLACE_TRIAL.startingBankroll
  let peak = balance
  let drawdown = 0
  for (const bet of ordered) {
    const day = melbourneDateKey(bet.race.start)
    daily.set(day, (daily.get(day) ?? 0) + bet.profit)
    losingStreak = bet.status === 'LOST' ? losingStreak + 1 : 0
    longestLosingStreak = Math.max(longestLosingStreak, losingStreak)
    balance += bet.profit
    peak = Math.max(peak, balance)
    drawdown = Math.max(drawdown, peak - balance)
  }
  const samples = ordered.map(bet => ({ modelProbability: bet.probability!, won: bet.status === 'WON' }))
  const wins = samples.filter(sample => sample.won).length
  const size = samples.length
  const observed = size ? wins / size : null
  const zSquared = 1.96 ** 2
  const centre = size ? (observed! + zSquared / (2 * size)) / (1 + zSquared / size) : 0
  const radius = size ? 1.96 * Math.sqrt(observed! * (1 - observed!) / size + zSquared / (4 * size ** 2)) / (1 + zSquared / size) : 0
  return { expectedHitRate: size ? samples.reduce((total, sample) => total + sample.modelProbability, 0) / size : null,
    hitRate: observed, hitRateInterval: size ? [Math.max(0, centre - radius), Math.min(1, centre + radius)] : null,
    brier: brierScore(samples), logLoss: logLoss(samples), calibration: bucketCalibration(samples),
    days: daily.size, losingDays: [...daily.values()].filter(profit => profit < 0).length,
    worstDay: daily.size ? Math.min(...daily.values()) : null, longestLosingStreak, drawdown,
    daily: [...daily].map(([day, profit]) => ({ day, profit })),
    reviewReady: size >= TAB_PLACE_TRIAL.minimumReviewRaces && daily.size >= TAB_PLACE_TRIAL.minimumReviewDays }
}

export function tabPlaceProspectiveReport(races: SimulationRace[]) {
  const observed = races.filter(race => [7, 8].includes(race.fieldSize) && isTabPlaceTrial(race.tabPlaceResearch))
  const all = simulationCandidates(observed).filter(bet => bet.market === 'PLACE' && bet.source === 'tab_decision' && bet.selection.model === TAB_PLACE_TRIAL.model)
  const eligible = observed.filter(race => eligibleField(race, all.filter(bet => bet.race.id === race.id)))
  const eligibleIds = new Set(eligible.map(race => race.id))
  const qualified = all.filter(bet => eligibleIds.has(bet.race.id) && bet.probability! * bet.odds! - 1 >= TAB_PLACE_TRIAL.minimumExpectedReturn)
  const cohorts = ([7, 8] as const).flatMap(fieldSize => [
    { name: 'Favourite', minimum: 1, maximum: 1 }, { name: 'Ranks 2-4', minimum: 2, maximum: 4 }, { name: 'Outsiders (5+)', minimum: 5, maximum: 0 },
  ].map(cohort => {
    const filter = { ...DEFAULT_SIMULATION_FILTERS, source: 'tab_decision', model: TAB_PLACE_TRIAL.model,
      maxRank: 0, minTop3: 0, minEdge: TAB_PLACE_TRIAL.minimumEdgePoints, inclusiveThresholds: true, positiveValueOnly: true,
      maxOdds: TAB_PLACE_TRIAL.maximumOdds, minimumFieldSize: fieldSize, maxField: fieldSize + 1,
      minTabMarketRank: cohort.minimum, maxTabMarketRank: cohort.maximum, onePerRace: true }
    const result = simulateBets(qualified, { WIN: { ...filter, enabled: false }, PLACE: filter }, {
      startingBankroll: TAB_PLACE_TRIAL.startingBankroll, flatStake: TAB_PLACE_TRIAL.flatStake, method: 'flat', stakePercent: 1,
    })
    return { fieldSize, cohort: cohort.name, summary: result.summaries[0] ?? null, risk: summarizeBets(result.bets), bets: result.bets }
  }))
  return { rules: TAB_PLACE_TRIAL, observedRaces: observed.length, eligibleRaces: eligible.length,
    unknownTermsRaces: new Set(all.filter(bet => !bet.selection.placeTermsVerified).map(bet => bet.race.id)).size,
    otherExcludedRaces: observed.length - eligible.length - new Set(all.filter(bet => !bet.selection.placeTermsVerified).map(bet => bet.race.id)).size,
    firstObservation: all.map(bet => bet.selection.evaluatedAt).filter((value): value is string => !!value).sort()[0] ?? null,
    cohorts, productionChanged: false }
}