import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SiteNav } from '@/components/site-nav'

export const dynamic = 'force-dynamic'

export default async function ArchivedBets({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams
  const db = await createClient({ signal: AbortSignal.timeout(5000) })
  let query = db.from('paper_bets').select('id, placed_at, runner_name, source, model_version, bet_type, stake, tab_decimal_odds, status, profit').order('id', { ascending: false }).limit(101)
  if (before && /^[a-f0-9-]{36}$/i.test(before)) query = query.lt('id', before)
  const { data, error } = await query.retry(false)
  const rows = (data ?? []).slice(0, 100)
  return <div className="min-h-screen bg-slate-50"><header className="border-b bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5"><h1 className="text-xl font-bold">Archived Paper Bets</h1><SiteNav /></div></header>
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6"><Link href="/paper-betting" className="text-teal-800 underline">Historical simulator</Link><p className="text-sm text-slate-600">Read-only legacy records. Existing pending bets may still settle; no new bets are created. Record-ID pagination preserves access to the full archive.</p>
      {error ? <p role="alert">Archive temporarily unavailable. Existing records have not been changed.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr>{['Placed', 'Runner', 'Source / model', 'Market', 'Stake', 'Odds', 'Status', 'Profit'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t bg-white"><td className="p-2">{new Date(row.placed_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}</td><td className="p-2">{row.runner_name}</td><td className="p-2">{row.source} / {row.model_version}</td><td className="p-2">{row.bet_type}</td><td className="p-2">${Number(row.stake).toFixed(2)}</td><td className="p-2">{row.tab_decimal_odds}</td><td className="p-2">{row.status}</td><td className="p-2">{row.profit === null ? '-' : `$${Number(row.profit).toFixed(2)}`}</td></tr>)}</tbody></table>{!rows.length && <p className="py-4">No archived bets.</p>}</div>}
      <div className="flex gap-5 text-sm">{before && <Link href="/paper-betting/archive" prefetch={false} className="text-teal-800 underline">First page</Link>}{data && data.length > 100 && <Link href={`/paper-betting/archive?before=${rows[rows.length - 1].id}`} prefetch={false} className="text-teal-800 underline">Next 100 records</Link>}</div>
    </main></div>
}