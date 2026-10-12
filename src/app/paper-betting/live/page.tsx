import Link from 'next/link'
import { SiteNav } from '@/components/site-nav'
import { SnapshotStatus } from '@/components/snapshot-status'
import { createClient } from '@/lib/supabase/server'
import { readPageSnapshot } from '@/lib/page-cache-reader'
import type { loadValidationSnapshot } from '@/lib/page-snapshot-loaders'
import { loadPaperPageSection } from '@/lib/paper-betting/page-section'
import { legacyPaperBettingEnabled } from '@/lib/betting/legacy-betting'
import { hasAdminSession } from '@/lib/admin-auth'
import { BankrollSettings } from '../bankroll-settings'

export const dynamic = 'force-dynamic'

const money = (value: number | null | undefined) => value == null ? 'Unavailable' : `$${Number(value).toFixed(2)}`
const percent = (value: number | null | undefined) => value == null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`

async function loadLedger() {
  const db = await createClient({ signal: AbortSignal.timeout(5000) })
  const account = await db.from('paper_accounts').select('id, starting_bankroll, current_bankroll, staking_method').eq('name', 'default').retry(false).maybeSingle()
  if (account.error) throw account.error
  if (!account.data) return null
  const bets = await db.from('paper_bets').select('id, placed_at, runner_name, source, model_version, bet_type, stake, tab_decimal_odds, model_probability, status, profit')
    .eq('account_id', account.data.id).order('placed_at', { ascending: false }).order('id', { ascending: false }).retry(false).limit(100)
  if (bets.error) throw bets.error
  return { account: account.data, bets: bets.data ?? [] }
}

export default async function LivePaperBettingPage() {
  const [ledgerResult, validation, canEdit] = await Promise.all([
    loadPaperPageSection('live-ledger', loadLedger),
    readPageSnapshot<Awaited<ReturnType<typeof loadValidationSnapshot>>>('validation'),
    hasAdminSession(),
  ])
  const ledger = ledgerResult.data
  const report = ledger && validation && validation.data.accountId === ledger.account.id ? validation.data.report : null
  const total = report?.windows.find(window => window.label === 'All bets')
  const bonuses = report ? validation?.data.bonusCredits : undefined
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5"><h1 className="text-xl font-bold">Live Paper Betting</h1><SiteNav /></div></header>
    <main className="mx-auto max-w-7xl space-y-7 px-4 py-6">
      <nav className="flex flex-wrap gap-5 text-sm"><Link href="/paper-betting" className="text-teal-800 underline">Historical simulator</Link><Link href="/paper-betting/archive" prefetch={false} className="text-teal-800 underline">Full bet archive</Link><Link href="/admin" className="text-teal-800 underline">Administration</Link></nav>
      <p className="text-sm text-slate-600">Simulated money only. Automatic paper placement: <strong>{legacyPaperBettingEnabled() ? 'Enabled' : 'Paused'}</strong>. Existing bets and results are preserved.</p>
      {!ledgerResult.ok ? <p role="alert">Paper account temporarily unavailable.</p> : !ledger ? <p>No paper account yet. The next enabled scheduled run creates the simulated account.</p> : <>
        <dl className="grid grid-cols-2 gap-4 border-y border-slate-200 py-5 sm:grid-cols-4">
          {[['Current bankroll', money(ledger.account.current_bankroll)], ['Starting bankroll', money(ledger.account.starting_bankroll)], ['Settled cash profit', money(total?.netProfit)], ['Settled cash ROI', total ? `${total.roiPct.toFixed(1)}%` : 'Unavailable']].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-semibold">{value}</dd></div>)}
        </dl>
        {canEdit && legacyPaperBettingEnabled() && <BankrollSettings currentStartingBankroll={Number(ledger.account.starting_bankroll)} currentStakingMethod={ledger.account.staking_method} betCount={ledger.bets.length} preserveHistoryOnly />}
        <section>
          <h2 className="text-lg font-semibold">Accuracy And Results</h2>
          {report ? <>
            <SnapshotStatus generatedAt={validation?.generatedAt} />
            <p className="mb-3 text-sm text-slate-600">{report.totalSettled} settled WIN/PLACE bets. Refunds and pending bets are excluded from strike rate. Bets in the same race are correlated; past performance does not establish future profitability.</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr>{['Market', 'Bets / races', 'Predicted hit rate', 'Actual hit rate', 'Cash ROI', 'Cash profit'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{report.markets.filter(market => market.label.endsWith('/ all')).map(market => <tr key={market.label} className="border-t"><td className="p-2">{market.label.replace(' / all', '')}</td><td className="p-2">{market.n} / {market.races}</td><td className="p-2">{percent(market.expectedHitRate)}</td><td className="p-2">{percent(market.winRate)}</td><td className="p-2">{market.roiPct == null ? 'Unavailable' : `${market.roiPct.toFixed(1)}%`}</td><td className="p-2">{money(market.netProfit)}</td></tr>)}</tbody></table></div>
            <p className="mt-3 text-xs text-slate-600">Brier score: {report.calibration.brierScore?.toFixed(4) ?? 'Unavailable'}; log loss: {report.calibration.logLoss?.toFixed(4) ?? 'Unavailable'}. Lower is better.</p>
            <h3 className="mb-2 mt-5 font-semibold">Policy Performance</h3>
            <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr>{['Policy / source / model', 'Market', 'Bets / races', 'Strike rate', 'Cash ROI'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{report.policies.flatMap(policy => policy.markets.filter(market => market.label.endsWith('/ all')).map(market => <tr key={`${policy.policyVersion}:${policy.source}:${policy.mode}:${policy.modelVersion}:${market.label}`} className="border-t"><td className="p-2">{policy.policyVersion}<div className="text-xs text-slate-500">{policy.source} / {policy.mode} / {policy.modelVersion}</div></td><td className="p-2">{market.label.replace(' / all', '')}</td><td className="p-2">{market.n} / {market.races}</td><td className="p-2">{percent(market.winRate)}</td><td className="p-2">{market.roiPct == null ? 'Unavailable' : `${market.roiPct.toFixed(1)}%`}</td></tr>))}</tbody></table></div>
          </> : <p className="mt-2 text-sm text-amber-800">Performance snapshot unavailable. Refresh validation from Administration; no statistics are inferred from the recent-bet sample.</p>}
        </section>
        <section><h2 className="text-lg font-semibold">Bonus-Bet Credits</h2>
          <p className="mt-1 text-xs text-slate-600">Conditional simulated face value only, not a cash refund or a TAB-issued balance. Bonus redemption, expiry and conversion to cash are not simulated. Credits never increase cash bankroll or cash ROI.</p>
          {bonuses ? <><p className="my-3 text-lg font-semibold">{money(bonuses.reduce((sum, bonus) => sum + bonus.credit, 0))} earned · {bonuses.filter(bonus => bonus.status === 'PENDING').length} pending</p><ul className="divide-y">{bonuses.filter(bonus => bonus.credit > 0 || bonus.status === 'PENDING').map(bonus => <li key={bonus.betId} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{bonus.runnerName}</span><span>{bonus.status === 'PENDING' ? `Pending, up to ${money(bonus.cap)}` : `${money(bonus.credit)} bonus credit`}</span></li>)}</ul></> : <p className="mt-2 text-sm text-amber-800">Bonus-credit snapshot unavailable.</p>}
        </section>
        <section><h2 className="mb-3 text-lg font-semibold">Latest 100 Bets</h2><p className="mb-3 text-xs text-slate-600">Recorded odds at placement; internal prices are not necessarily TAB. Cash profit excludes promotional bonus credits.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead><tr>{['Placed (UTC)', 'Runner / model', 'Market', 'Stake', 'Odds', 'Forecast', 'Result', 'Cash profit'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{ledger.bets.map(bet => <tr key={bet.id} className="border-t"><td className="p-2">{new Date(bet.placed_at).toISOString().replace('T', ' ').slice(0, 16)}</td><td className="p-2">{bet.runner_name}<div className="text-xs text-slate-500">{bet.source} / {bet.model_version}</div></td><td className="p-2">{bet.bet_type}</td><td className="p-2">{money(bet.stake)}</td><td className="p-2">{Number(bet.tab_decimal_odds).toFixed(2)}</td><td className="p-2">{percent(bet.model_probability)}</td><td className="p-2">{bet.status}</td><td className="p-2">{money(bet.profit)}</td></tr>)}</tbody></table></div>
          {!ledger.bets.length && <p>No paper bets recorded.</p>}
        </section>
      </>}
    </main>
  </div>
}