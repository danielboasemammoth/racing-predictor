import { createClient } from '@/lib/supabase/server'
import { computeWalletStats, type WalletBetForStats } from '@/lib/betting/paper-wallet'
import { SiteNav } from '@/components/site-nav'

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
  mode: string
  stake: number
  tab_decimal_odds: number
  edge_points: number | null
  confidence_level: string | null
  status: string
  profit: number | null
  placed_at: string
  pe_races: { venue: string; race_number: number; category: string; start_time: string } | { venue: string; race_number: number; category: string; start_time: string }[] | null
}

function raceLabel(row: PaperBetRow) {
  const race = Array.isArray(row.pe_races) ? row.pe_races[0] : row.pe_races
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

  const bets = await supabase
    .from('paper_bets')
    .select('*, pe_races(venue, race_number, category, start_time)')
    .eq('account_id', account.data.id)
    .order('placed_at', { ascending: false })
    .limit(200)
  if (bets.error) throw bets.error

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
  }
}

export default async function PaperBettingPage() {
  const wallet = await loadWallet()

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

        {!wallet ? (
          <p className="text-sm text-slate-600">
            No paper betting account yet - run &ldquo;Sync PuntersEdge Odds &amp; Recommendations&rdquo; from
            the Admin page to create the default account and start generating recommendations.
          </p>
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
                        <td className="px-3 py-2 text-slate-700">{raceLabel(bet)}</td>
                        <td className="px-3 py-2 text-slate-900">{bet.runner_name}</td>
                        <td className="px-3 py-2 text-slate-500">{bet.mode}</td>
                        <td className="px-3 py-2 text-slate-700">${bet.tab_decimal_odds.toFixed(2)}</td>
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
