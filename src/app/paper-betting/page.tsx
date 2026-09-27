import Link from 'next/link'
import { SiteNav } from '@/components/site-nav'
import { HistoricalSimulator } from './historical-simulator'

export default function PaperBettingPage() {
  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-5">
      <h1 className="text-xl font-bold">Paper Betting</h1><SiteNav />
    </div></header>
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Historical Simulator</h2>
        <Link href="/paper-betting/archive" prefetch={false} className="text-sm text-teal-800 underline">Archived bets</Link>
      </div>
      <HistoricalSimulator />
    </main>
  </div>
}