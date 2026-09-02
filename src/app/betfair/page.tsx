import { createAdminClient } from '@/lib/supabase/admin'
import { SiteNav } from '@/components/site-nav'
import { BankrollPanel } from './bankroll-panel'
import { RiskSettingsPanel } from './risk-settings-panel'
import { AutomationPanel } from './automation-panel'
import { SimulateBetForm } from './simulate-bet-form'

export const dynamic = 'force-dynamic'

interface BetRow {
  id: string
  runner_name: string
  venue: string | null
  race_number: number | null
  racing_code: string
  bet_mode: string
  status: string
  requested_stake: number
  matched_stake: number | null
  requested_odds: number
  matched_odds: number | null
  raw_edge_pct: number | null
  commission_adjusted_edge_pct: number | null
  net_profit: number | null
  placed_at: string
}

async function loadDashboard() {
  const admin = createAdminClient()
  const [bankroll, risk, automation, bets] = await Promise.all([
    admin.from('betfair_bankroll_config').select('*').limit(1).single(),
    admin.from('betfair_risk_settings').select('*').limit(1).single(),
    admin.from('betfair_automation_state').select('*').limit(1).single(),
    admin.from('betfair_bets').select('*').order('placed_at', { ascending: false }).limit(50),
  ])
  if (bankroll.error || risk.error || automation.error) return null
  return { bankroll: bankroll.data, risk: risk.data, automation: automation.data, bets: (bets.data ?? []) as BetRow[] }
}

const STATUS_STYLES: Record<string, string> = {
  MATCHED: 'bg-emerald-50 text-emerald-800',
  PARTIALLY_MATCHED: 'bg-amber-50 text-amber-800',
  UNMATCHED: 'bg-slate-100 text-slate-600',
  WON: 'bg-emerald-50 text-emerald-800',
  LOST: 'bg-red-50 text-red-800',
}

export default async function BetfairPage() {
  const data = await loadDashboard()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-semibold text-slate-900">Betfair Integration</h1>
          <SiteNav />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
        <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-bold text-emerald-900">SIMULATION MODE</p>
          <p className="text-xs text-emerald-800">
            No real Betfair account is connected yet (Stage 1 of the integration). All bets on this page are simulated -
            no real money moves. Simulated bankroll: ${data ? Number(data.bankroll.simulated_current_bankroll).toFixed(2) : '—'}
          </p>
          <p className="mt-1 text-[11px] text-emerald-700">
            Betfair: DISCONNECTED · Market Data: UNAVAILABLE (no credentials configured) · Live Betting: DISABLED
          </p>
        </div>

        {!data ? (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
            Betfair tables not found - run <code>supabase/migrate-betfair-stage1.sql</code> in the Supabase SQL editor first.
          </p>
        ) : (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Automation</h2>
              <AutomationPanel
                mode={data.automation.mode}
                liveBettingEnabled={data.automation.live_betting_enabled}
                allocatedBankroll={data.bankroll.allocated_bankroll}
                maxBet={data.risk.max_bet}
                maxDailyStake={data.risk.max_daily_stake}
                maxDailyLossPct={data.risk.max_daily_loss_pct}
                stakingMethod={data.risk.staking_method}
                minEdgePct={data.risk.min_edge_pct}
                minConfidence={data.risk.min_confidence}
              />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Bankroll Allocation</h2>
              <BankrollPanel
                actualBetfairBalance={data.bankroll.actual_betfair_balance}
                allocatedBankroll={data.bankroll.allocated_bankroll}
                reserveBalance={data.bankroll.reserve_balance}
                bankrollCeiling={data.bankroll.bankroll_ceiling}
                withdrawalThreshold={data.bankroll.withdrawal_threshold}
                topupThreshold={data.bankroll.topup_threshold}
                simulatedStartingBankroll={data.bankroll.simulated_starting_bankroll}
                simulatedCurrentBankroll={data.bankroll.simulated_current_bankroll}
              />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Risk &amp; Staking Rules</h2>
              <RiskSettingsPanel
                minConfidence={data.risk.min_confidence}
                minEdgePct={data.risk.min_edge_pct}
                minOdds={data.risk.min_odds}
                maxOdds={data.risk.max_odds}
                minLiquidity={data.risk.min_liquidity}
                maxBet={data.risk.max_bet}
                maxPctBankroll={data.risk.max_pct_bankroll}
                maxTotalExposurePct={data.risk.max_total_exposure_pct}
                maxDailyStake={data.risk.max_daily_stake}
                maxDailyLossPct={data.risk.max_daily_loss_pct}
                maxBetsPerDay={data.risk.max_bets_per_day}
                maxBetsPerRace={data.risk.max_bets_per_race}
                minMinutesToJump={data.risk.min_minutes_to_jump}
                maxMinutesToJump={data.risk.max_minutes_to_jump}
                horseEnabled={data.risk.horse_enabled}
                greyhoundEnabled={data.risk.greyhound_enabled}
                nswThoroughbredAutoEnabled={data.risk.nsw_thoroughbred_auto_enabled}
                stakingMethod={data.risk.staking_method}
                flatStakeAmount={data.risk.flat_stake_amount}
                pctBankrollStake={data.risk.pct_bankroll_stake}
              />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Simulate a Bet (Stage 1 testing tool)</h2>
              <p className="mb-2 text-xs text-slate-500">
                No real Betfair market feed exists yet, so you manually enter a &ldquo;current market&rdquo; snapshot below. The
                exact same risk engine, staking, and commission math that will drive real bets in Stage 2+ runs here.
              </p>
              <SimulateBetForm />
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Bet History</h2>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Runner</th>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Odds</th>
                      <th className="px-3 py-2">Stake</th>
                      <th className="px-3 py-2">Edge (raw / adj)</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.bets.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-4 text-center text-sm text-slate-500">No simulated bets yet.</td></tr>
                    ) : (
                      data.bets.map((bet) => (
                        <tr key={bet.id}>
                          <td className="px-3 py-2 text-slate-900">{bet.runner_name}</td>
                          <td className="px-3 py-2 text-slate-500">{bet.racing_code}</td>
                          <td className="px-3 py-2 text-slate-500">{bet.bet_mode}</td>
                          <td className="px-3 py-2 text-slate-700">${bet.matched_odds?.toFixed(2) ?? bet.requested_odds.toFixed(2)}</td>
                          <td className="px-3 py-2 text-slate-700">${(bet.matched_stake ?? bet.requested_stake).toFixed(2)}</td>
                          <td className="px-3 py-2 text-slate-700">
                            {bet.raw_edge_pct?.toFixed(1) ?? 'n/a'}% / {bet.commission_adjusted_edge_pct?.toFixed(1) ?? 'n/a'}%
                          </td>
                          <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[bet.status] ?? 'bg-slate-100 text-slate-600'}`}>{bet.status}</span></td>
                        </tr>
                      ))
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
