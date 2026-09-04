import { createClient } from '@/lib/supabase/server'
import { computeWalletStats, type WalletBetForStats } from '@/lib/betting/paper-wallet'
import { SiteNav } from '@/components/site-nav'
import { queryLatestOpportunities, type OpportunityRow } from '@/lib/paper-betting/opportunities-query'
import { computeValidationReport, type ValidationReport } from '@/lib/paper-betting/validation-query'
import { WhatIfLab } from './what-if-lab'
import { BankrollSettings } from './bankroll-settings'

interface PaperAccountRow {
  id: string
  starting_bankroll: number
  current_bankroll: number
  staking_method: string
}

interface PaperBetRow {
  id: string
  race_id: string
  runner_name: string
  category: string
  source: string
  mode: string
  stake: number
  tab_decimal_odds: number
  edge_points: number | null
  confidence_level: string | null
  status: string
  profit: number | null
  placed_at: string
}

function raceLabel(row: PaperBetRow, internalRaces: Map<string, { venue: string; raceNumber: number }>, peRaces: Map<string, { venue: string; race_number: number }>) {
  if (row.source === 'internal') {
    const race = internalRaces.get(row.race_id)
    return race ? `${race.venue} R${race.raceNumber}` : `Race ${row.race_id}`
  }
  const race = peRaces.get(row.race_id)
  if (!race) return `Race ${row.race_id}`
  return `${race.venue} R${race.race_number}`
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800',
  WON: 'bg-emerald-50 text-emerald-800',
  LOST: 'bg-red-50 text-red-800',
  VOID: 'bg-slate-100 text-slate-600',
  SCRATCHED: 'bg-slate-100 text-slate-600',
  ABANDONED: 'bg-slate-100 text-slate-600',
}

async function loadWallet() {
  const supabase = await createClient()
  const account = await supabase.from('paper_accounts').select('*').eq('name', 'default').maybeSingle()
  if (account.error) throw account.error
  if (!account.data) return null

  // paper_bets.race_id no longer has a DB-level FK to pe_races (see migrate-paper-betting-internal-source.sql
  // - it can point at either pe_races or the internal races table depending on `source`), so PostgREST can no
  // longer auto-embed pe_races. Fetch bets first, then separately resolve race info per source below.
  const bets = await supabase
    .from('paper_bets')
    .select('*')
    .eq('account_id', account.data.id)
    .order('placed_at', { ascending: false })
    .limit(200)
  if (bets.error) throw bets.error

  const internalRaceIds = [...new Set((bets.data ?? []).filter((b) => b.source === 'internal').map((b) => b.race_id))]
  const internalRaces = new Map<string, { venue: string; raceNumber: number }>()
  if (internalRaceIds.length) {
    const internal = await supabase.from('races').select('id, race_number, racecourses(name)').in('id', internalRaceIds)
    for (const row of internal.data ?? []) {
      const course = Array.isArray(row.racecourses) ? row.racecourses[0] : row.racecourses
      internalRaces.set(row.id, { venue: course?.name ?? 'Unknown venue', raceNumber: row.race_number })
    }
  }

  const peRaceIds = [...new Set((bets.data ?? []).filter((b) => b.source !== 'internal').map((b) => b.race_id))]
  const peRaces = new Map<string, { venue: string; race_number: number }>()
  if (peRaceIds.length) {
    const pe = await supabase.from('pe_races').select('id, venue, race_number').in('id', peRaceIds)
    for (const race of pe.data ?? []) peRaces.set(race.id, race)
  }

  const chronological = [...(bets.data ?? [])].reverse() as PaperBetRow[]
  const statsInput: WalletBetForStats[] = chronological.map((b) => ({
    stake: b.stake,
    decimalOdds: b.tab_decimal_odds,
    edgePoints: b.edge_points,
    result: b.status as WalletBetForStats['result'],
    profit: b.profit,
  }))

  return {
    account: account.data as PaperAccountRow,
    stats: computeWalletStats(account.data.starting_bankroll as number, statsInput),
    recentBets: (bets.data ?? []) as PaperBetRow[],
    internalRaces,
    peRaces,
  }
}

function raceOf(row: OpportunityRow) {
  return Array.isArray(row.pe_races) ? row.pe_races[0] : row.pe_races
}

function runnerOf(row: OpportunityRow) {
  return Array.isArray(row.pe_runners) ? row.pe_runners[0] : row.pe_runners
}

async function loadBestOpportunities() {
  const supabase = await createClient()
  return queryLatestOpportunities(supabase, { limit: 10 })
}

async function loadValidation(accountId: string | undefined): Promise<ValidationReport | null> {
  if (!accountId) return null
  const supabase = await createClient()
  return computeValidationReport(supabase, accountId)
}

export default async function PaperBettingPage() {
  const wallet = await loadWallet()
  const [opportunities, validation] = await Promise.all([loadBestOpportunities(), loadValidation(wallet?.account.id)])

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold text-slate-900">Paper Betting</h1>
          <SiteNav />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Simulated bankroll only - no real bets are placed. Past paper-betting performance does not
          guarantee future results, and predicted probabilities can be wrong.
        </p>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Best Opportunities Now</h2>
          {opportunities.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
              No qualifying bets right now.
            </p>
          ) : (
            <ul className="space-y-2">
              {opportunities.map((rec) => {
                const race = raceOf(rec)
                const runner = runnerOf(rec)
                if (!race || !runner || rec.tab_win_price == null) return null
                return (
                  <li
                    key={rec.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2 text-sm ${rec.decision === 'BET' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
                  >
                    <span className="font-medium text-slate-900">
                      {race.venue} R{race.race_number} · #{runner.runner_number} {runner.name} ({race.category})
                    </span>
                    <span className="flex flex-wrap gap-3 text-xs text-slate-600">
                      <span>TAB ${rec.tab_win_price.toFixed(2)}</span>
                      <span>Edge {rec.edge_points != null ? `${rec.edge_points >= 0 ? '+' : ''}${rec.edge_points.toFixed(1)}pts` : 'n/a'}</span>
                      <span className="font-semibold">{rec.decision}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {validation && validation.totalSettled > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Model Validation</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Window</th>
                    <th className="px-3 py-2">Bets</th>
                    <th className="px-3 py-2">Strike Rate</th>
                    <th className="px-3 py-2">ROI</th>
                    <th className="px-3 py-2">Net Profit</th>
                    <th className="px-3 py-2">Max Drawdown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {validation.windows.filter((w) => w.n > 0).map((w) => (
                    <tr key={w.label}>
                      <td className="px-3 py-2 text-slate-700">{w.label}</td>
                      <td className="px-3 py-2 text-slate-700">{w.n}</td>
                      <td className="px-3 py-2 text-slate-700">{w.winRate != null ? `${(w.winRate * 100).toFixed(1)}%` : 'n/a'}</td>
                      <td className={`px-3 py-2 font-medium ${w.roiPct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{w.roiPct >= 0 ? '+' : ''}{w.roiPct.toFixed(1)}%</td>
                      <td className={`px-3 py-2 font-medium ${w.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{w.netProfit >= 0 ? '+' : ''}${w.netProfit.toFixed(2)}</td>
                      <td className="px-3 py-2 text-slate-700">{w.maxDrawdownPct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
              <span>Brier score: {validation.calibration.brierScore != null ? validation.calibration.brierScore.toFixed(4) : 'n/a'} (0 = perfect)</span>
              <span>Log loss: {validation.calibration.logLoss != null ? validation.calibration.logLoss.toFixed(4) : 'n/a'}</span>
              <span>{validation.calibration.credibleBuckets.length} credible probability band{validation.calibration.credibleBuckets.length === 1 ? '' : 's'} (n≥30)</span>
            </div>
            {validation.calibration.credibleBuckets.length > 0 && (
              <div className="mt-2 space-y-1 text-xs text-slate-700">
                {validation.calibration.credibleBuckets.map((b) => (
                  <div key={b.bucketLabel} className="flex items-center gap-3">
                    <span className="w-16">{b.bucketLabel}</span>
                    <span>expected {(b.expectedWinRate * 100).toFixed(1)}%</span>
                    <span>actual {b.actualWinRate != null ? `${(b.actualWinRate * 100).toFixed(1)}%` : 'n/a'}</span>
                    <span className="text-slate-400">(n={b.sampleSize})</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-slate-200 pt-3">
              <h3 className="text-xs font-semibold uppercase text-slate-500">Drift Detection (recent 50 vs baseline)</h3>
              {!validation.drift.sufficientData ? (
                <p className="mt-1 text-xs text-slate-500">Not enough settled bets yet to compare recent performance against a baseline (needs 30+ in each window).</p>
              ) : validation.drift.flags.length === 0 ? (
                <p className="mt-1 text-xs text-emerald-700">No drift detected - recent performance is consistent with the historical baseline.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {validation.drift.flags.map((flag) => (
                    <li key={flag.metric} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{flag.message}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}


        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-900">What-If Analysis</h2>
          <WhatIfLab />
        </section>

        {!wallet ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Set Up Paper Betting</h2>
            <p className="mb-3 text-sm text-slate-600">
              Choose a starting budget to begin. You can place paper bets from the home page or the Greyhounds page once this is set up.
            </p>
            <BankrollSettings currentStartingBankroll={null} betCount={0} />
          </section>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Current Bankroll" value={`$${wallet.stats.currentBankroll.toFixed(2)}`} />
              <Stat label="Starting Bankroll" value={`$${wallet.stats.startingBankroll.toFixed(2)}`} />
              <Stat label="Net Profit" value={`${wallet.stats.netProfit >= 0 ? '+' : ''}$${wallet.stats.netProfit.toFixed(2)}`} accent={wallet.stats.netProfit >= 0} />
              <Stat label="ROI" value={`${wallet.stats.roiPct >= 0 ? '+' : ''}${wallet.stats.roiPct.toFixed(1)}%`} accent={wallet.stats.roiPct >= 0} />
              <Stat label="Win Rate" value={wallet.stats.winRate != null ? `${(wallet.stats.winRate * 100).toFixed(1)}%` : 'n/a'} />
              <Stat label="Max Drawdown" value={`${wallet.stats.maxDrawdownPct.toFixed(1)}%`} />
              <Stat label="Bets Placed" value={String(wallet.stats.numberOfBets)} />
              <Stat label="Pending" value={String(wallet.stats.numberPending)} />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Bankroll Settings</h2>
              <BankrollSettings currentStartingBankroll={wallet.account.starting_bankroll} currentStakingMethod={wallet.account.staking_method} betCount={wallet.stats.numberOfBets} />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent Paper Bets</h2>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Race</th>
                      <th className="px-3 py-2">Runner</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Odds</th>
                      <th className="px-3 py-2">Stake</th>
                      <th className="px-3 py-2">Edge</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {wallet.recentBets.map((bet) => (
                      <tr key={bet.id}>
                        <td className="px-3 py-2 text-slate-700">{raceLabel(bet, wallet.internalRaces, wallet.peRaces)}</td>
                        <td className="px-3 py-2 text-slate-900">{bet.runner_name}</td>
                        <td className="px-3 py-2 text-slate-500">{bet.mode}</td>
                        <td className="px-3 py-2 text-slate-700" title={bet.source === 'internal' ? 'Recorded price (Racing.com feed, not confirmed TAB/Betfair)' : 'TAB price'}>
                          ${bet.tab_decimal_odds.toFixed(2)}{bet.source === 'internal' && <span className="ml-1 text-[10px] text-slate-400">rec.</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-700">${bet.stake.toFixed(2)}</td>
                        <td className="px-3 py-2 text-slate-700">{bet.edge_points != null ? `${bet.edge_points >= 0 ? '+' : ''}${bet.edge_points.toFixed(1)}pts` : 'n/a'}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[bet.status] ?? 'bg-slate-100 text-slate-600'}`}>{bet.status}</span>
                        </td>
                        <td className={`px-3 py-2 font-medium ${bet.profit != null && bet.profit > 0 ? 'text-emerald-700' : bet.profit != null && bet.profit < 0 ? 'text-red-700' : 'text-slate-500'}`}>
                          {bet.profit != null ? `${bet.profit >= 0 ? '+' : ''}$${bet.profit.toFixed(2)}` : 'n/a'}
                        </td>
                      </tr>
                    ))}
                    {wallet.recentBets.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-slate-500">No paper bets yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent === true ? 'text-emerald-700' : accent === false ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
    </div>
  )
}
