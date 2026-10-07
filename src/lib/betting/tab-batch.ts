import { melbourneDateKey } from '../daily-picks'
import { matchesSimulationFilters, simulationCandidates, simulationSettlementOdds, type SimulationBet, type SimulationRace } from './historical-simulator'
import type { SimulationPreferences } from './simulation-preferences'
import { normalizeHorseName } from '../paper-betting/fundamentals-bridge'

export type TabJurisdiction = 'VIC' | 'NSW' | 'QLD'
export interface TabBatchRace {
  id: string
  code: string
  start: string
  number: number
  venue: string
  winOpen: boolean
  placeOpen: boolean
  runners: Array<{ number: number; name: string; open: boolean }>
}
export interface TabBatchPreview {
  generatedAt: string
  expiresAt: string
  jurisdiction: TabJurisdiction
  text: string
  total: number
  rows: Array<{ race: string; start: string; horse: string; runner: number; market: string; model: string; stake: number; line: string }>
  excluded: Array<{ horse: string; race: string; reason: string }>
  warnings: string[]
}

export function formatTabBatchBet(code: string, race: number, runner: number, win: number, place: number): string {
  if (!/^[A-Z]R$/.test(code)) throw new Error('Unverified TAB batch venue code')
  if (!Number.isInteger(race) || race < 1 || race > 12 || !Number.isInteger(runner) || runner < 1 || runner > 24) throw new Error('Unsupported TAB race or runner number')
  const amount = (value: number) => {
    if (!Number.isFinite(value) || value < 0 || value > 99999.9 || Math.abs(value * 10 - Math.round(value * 10)) > 0.000001) throw new Error('TAB stakes must be non-negative multiples of $0.10')
    return value.toFixed(1).padStart(7, '0')
  }
  if (win + place <= 0) throw new Error('A positive stake is required')
  return `${code}-${String(race).padStart(2, '0')}-WP-${amount(win)}-${amount(place)}/${runner}/`
}

export function buildTabBatchPreview(races: SimulationRace[], tabRaces: TabBatchRace[], preferences: SimulationPreferences, jurisdiction: TabJurisdiction, now = new Date()): TabBatchPreview {
  if (preferences.settings.method !== 'flat') throw new Error('Tote batch export requires flat stakes. Percentage staking needs an actual available balance; Kelly needs a known dividend. No staking method has been substituted.')
  const stake = preferences.settings.flatStake
  formatTabBatchBet('MR', 1, 1, stake, 0)
  const preview: TabBatchPreview = { generatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 120_000).toISOString(), jurisdiction, text: '', total: 0, rows: [], excluded: [], warnings: [] }
  const today = melbourneDateKey(now)
  const upcoming = races.filter(race => Date.parse(race.start) > now.getTime() && melbourneDateKey(race.start) === today)
  const selected = simulationCandidates(upcoming).map(bet => simulationSettlementOdds(bet, preferences.filters[bet.market]))
    .filter(bet => matchesSimulationFilters(bet, preferences.filters[bet.market]))
  const eligible: Array<{ bet: SimulationBet; race: TabBatchRace; runner: TabBatchRace['runners'][number] }> = []
  for (const bet of selected) {
    const race = tabRaces.find(race => race.id === bet.race.id)
    const runners = race?.runners.filter(runner => normalizeHorseName(runner.name) === normalizeHorseName(bet.selection.horse)) ?? []
    const runner = runners.length === 1 ? runners[0] : undefined
    const exact = preferences.filters[bet.market].forecast === 'picks-history'
    const reason = !race ? 'No verified current TAB race' : !(Date.parse(race.start) > now.getTime()) || melbourneDateKey(race.start) !== today ? 'Race is no longer upcoming today'
      : !runner ? 'Runner name not uniquely matched at TAB' : !runner.open || bet.selection.scratched ? 'Runner scratched or betting closed'
      : !(bet.market === 'WIN' ? race.winOpen : race.placeOpen) ? 'Tote market closed or unavailable'
      : !exact && preferences.filters[bet.market].settlementOdds === 'tab' && bet.odds === null ? 'Configured TAB reference quote unavailable'
      : !exact && !bet.selection.fullField ? 'Current runner field differs from the forecast'
      : bet.market === 'PLACE' && bet.race.fieldSize < 8 && !bet.selection.placeTermsVerified ? 'Configured PLACE probability has no verified matching paid-place terms'
      : null
    if (reason) { preview.excluded.push({ horse: bet.selection.horse, race: `${bet.race.venue} R${bet.race.number}`, reason }); continue }
    eligible.push({ bet, race: race!, runner: runner! })
  }
  const best = new Map<string, typeof eligible[number]>()
  for (const entry of eligible) {
    const filter = preferences.filters[entry.bet.market]
    if (!filter.onePerRace || filter.forecast === 'picks-history') continue
    const key = `${entry.bet.race.id}:${entry.bet.selection.model}:${entry.bet.market}`
    const previous = best.get(key)
    const value = (bet: SimulationBet) => (bet.probability ?? 0) * (bet.odds ?? 0) - 1
    if (!previous || value(entry.bet) > value(previous.bet) || (value(entry.bet) === value(previous.bet) && entry.bet.id < previous.bet.id)) best.set(key, entry)
  }
  const seen = new Set<string>()
  for (const entry of eligible.sort((left, right) => left.race.start.localeCompare(right.race.start) || left.bet.id.localeCompare(right.bet.id))) {
    const { bet, race, runner } = entry
    const filter = preferences.filters[bet.market]
    if (filter.onePerRace && filter.forecast !== 'picks-history' && best.get(`${bet.race.id}:${bet.selection.model}:${bet.market}`) !== entry) continue
    const key = `${race.code}:${race.number}:${runner.number}:${bet.market}`
    if (seen.has(key)) throw new Error('Multiple model portfolios select the same TAB runner and market. Select one model per market before exporting; duplicate wagers were not generated.')
    seen.add(key)
    try {
      const line = formatTabBatchBet(race.code, race.number, runner.number, bet.market === 'WIN' ? stake : 0, bet.market === 'PLACE' ? stake : 0)
      preview.rows.push({ race: `${race.venue} R${race.number}`, start: race.start, horse: runner.name, runner: runner.number, market: bet.market, model: bet.selection.model, stake, line })
    } catch (error) { preview.excluded.push({ horse: runner.name, race: `${race.venue} R${race.number}`, reason: (error as Error).message }) }
  }
  if (preview.rows.length > 8000) throw new Error('TAB accepts at most 8,000 batch lines')
  preview.total = Math.round(preview.rows.length * stake * 100) / 100
  if (preview.total > preferences.settings.startingBankroll) throw new Error('Combined batch stake exceeds the configured starting bankroll. Reduce the selection or stake; future winnings are not available to fund this batch.')
  preview.text = preview.rows.map(row => row.line).join('\r\n')
  preview.expiresAt = new Date(Math.min(Date.parse(preview.expiresAt), ...preview.rows.map(row => Date.parse(row.start)))).toISOString()
  if (!preview.rows.length) preview.warnings.push('No eligible upcoming bets match this configuration and the available TAB evidence.')
  if (Object.values(preferences.filters).some(filter => filter.enabled && filter.forecast === 'picks-history')) preview.warnings.push('Exact-history Tote export uses the retained selections and flat stake, not historical settlement odds. A missing saved fixed-odds quote does not prevent a Tote bet; the final dividend remains unknown.')
  if (Object.values(preferences.filters).some(filter => filter.enabled && filter.forecast !== 'latest')) preview.warnings.push('History uses only previously archived selections; missing archives are not replaced by current picks. Decision mode uses frozen observations.')
  return preview
}