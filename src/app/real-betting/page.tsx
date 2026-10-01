import Link from 'next/link'
import { ShieldOff } from 'lucide-react'
import { SiteNav } from '@/components/site-nav'
import { hasAdminSession, isAdminConfigured } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadRealBettingLedger, type RealBettingLedger } from '@/lib/real-betting/ledger'
import { StrategyDraft } from './strategy-draft'

export const dynamic = 'force-dynamic'

const money = (amount: number | null) => amount === null ? '-' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(amount))
const date = (value: string) => new Date(value).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

async function readLedger(): Promise<RealBettingLedger> {
  try {
    return await loadRealBettingLedger(createAdminClient())
  } catch (error) {
    console.error('Real betting ledger unavailable', error)
    return { status: 'unavailable', message: 'The real betting ledger could not be read.' }
  }
}

function Ledger({ ledger }: { ledger: RealBettingLedger }) {
  if (ledger.status === 'migration-pending') return <p className="text-sm text-slate-600">The ledger tables do not exist yet. Apply <code className="text-xs">supabase/migrate-real-betting.sql</code> in the Supabase SQL Editor.</p>
  if (ledger.status === 'unavailable') return <p className="text-sm text-red-700">{ledger.message}</p>
  return <div className="space-y-5">
    <div>
      <h3 className="mb-2 text-sm font-semibold">Real bets ({ledger.bets.length})</h3>
      {ledger.bets.length === 0 ? <p className="text-sm text-slate-600">No real bets recorded. None can be placed while the provider is disconnected.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-3">Created</th><th className="pr-3">Strategy</th><th className="pr-3">Selection</th><th className="pr-3">Market</th><th className="pr-3">Stake</th><th className="pr-3">Status</th><th className="pr-3">Outcome</th><th>Return</th></tr></thead>
          <tbody>{ledger.bets.map(bet => <tr key={bet.id} className="border-t border-slate-100">
            <td className="py-1 pr-3">{date(bet.created_at)}</td><td className="pr-3">{bet.strategy_name}</td><td className="pr-3">{bet.race_ref} / {bet.selection_ref}</td><td className="pr-3">{bet.market}</td>
            <td className="pr-3">{money(bet.stake)}</td><td className="pr-3">{bet.status}</td><td className="pr-3">{bet.settlement_verified_at ? bet.outcome : 'Unverified'}</td><td>{money(bet.return_amount)}</td>
          </tr>)}</tbody>
        </table></div>}
    </div>
    <div>
      <h3 className="mb-2 text-sm font-semibold">Dry-run attempts ({ledger.attempts.length})</h3>
      <p className="mb-2 text-xs text-slate-500">Recorded by the local runner in dry-run mode. Every attempt is blocked; none affect any balance.</p>
      {ledger.attempts.length === 0 ? <p className="text-sm text-slate-600">No dry-run attempts recorded.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-3">Recorded</th><th className="pr-3">Strategy</th><th className="pr-3">Proposal</th><th className="pr-3">Decision</th><th>Reason</th></tr></thead>
          <tbody>{ledger.attempts.map(attempt => <tr key={attempt.id} className="border-t border-slate-100">
            <td className="py-1 pr-3">{date(attempt.created_at)}</td><td className="pr-3">{attempt.strategy_name}</td>
            <td className="pr-3">{attempt.proposed_market ? `${attempt.proposed_market} ${money(attempt.proposed_stake)}` : 'None'}</td><td className="pr-3">{attempt.decision}</td><td>{attempt.reason}</td>
          </tr>)}</tbody>
        </table></div>}
    </div>
  </div>
}

export default async function RealBettingPage() {
  const authenticated = isAdminConfigured() && await hasAdminSession()
  const ledger = authenticated ? await readLedger() : null
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5">
      <h1 className="text-xl font-bold">Real Betting</h1><SiteNav />
    </div></header>
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <div className="flex items-start gap-3 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <ShieldOff size={18} className="mt-0.5 shrink-0" aria-hidden />
        <div><p className="font-semibold">TAB provider: not connected</p>
          <p className="mt-1">No real bets can be placed. The local runner only accepts disabled or dry-run mode, and this site never receives TAB credentials.</p></div>
      </div>
      <StrategyDraft />
      <section className="border-t border-slate-200 py-4">
        <h2 className="mb-3 text-base font-semibold">Ledger</h2>
        {ledger ? <Ledger ledger={ledger} /> : <p className="text-sm text-slate-600">Ledger history is admin-only. <Link href="/admin" prefetch={false} className="text-teal-800 underline">Sign in</Link> to view it.</p>}
      </section>
    </main>
  </div>
}
