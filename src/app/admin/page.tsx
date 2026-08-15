import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

async function getAdminStats() {
  const supabase = await createClient()
  const [
    { count: racesCount },
    { count: horsesCount },
    { count: entriesCount },
    { count: predictionsCount },
    { count: accuracyCount },
  ] = await Promise.all([
    supabase.from('races').select('*', { count: 'exact', head: true }),
    supabase.from('horses').select('*', { count: 'exact', head: true }),
    supabase.from('race_entries').select('*', { count: 'exact', head: true }),
    supabase.from('predictions').select('*', { count: 'exact', head: true }),
    supabase.from('accuracy_log').select('*', { count: 'exact', head: true }),
  ])

  return {
    races: racesCount || 0,
    horses: horsesCount || 0,
    entries: entriesCount || 0,
    predictions: predictionsCount || 0,
    accuracy: accuracyCount || 0,
  }
}

export default async function AdminPage() {
  const stats = await getAdminStats()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Admin Panel</h1>
              <p className="text-sm text-slate-600 mt-1">Data ingestion and model controls</p>
            </div>
            <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">← Back to races</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-1">Races</p>
            <p className="text-3xl font-bold text-slate-900">{stats.races}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-1">Horses</p>
            <p className="text-3xl font-bold text-slate-900">{stats.horses}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-1">Entries</p>
            <p className="text-3xl font-bold text-slate-900">{stats.entries}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-1">Predictions</p>
            <p className="text-3xl font-bold text-slate-900">{stats.predictions}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-1">Accuracy Logs</p>
            <p className="text-3xl font-bold text-slate-900">{stats.accuracy}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Actions</h2>
          <div className="space-y-3">
            <form action="/api/admin/scrape" method="POST">
              <button type="submit" className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition">
                <p className="font-medium text-slate-900">Scrape Upcoming Races</p>
                <p className="text-xs text-slate-500 mt-1">Import upcoming races from public sources</p>
              </button>
            </form>
            <form action="/api/admin/scrape-results" method="POST">
              <button type="submit" className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition">
                <p className="font-medium text-slate-900">Scrape Race Results</p>
                <p className="text-xs text-slate-500 mt-1">Import results for completed races</p>
              </button>
            </form>
            <form action="/api/admin/predict" method="POST">
              <button type="submit" className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition">
                <p className="font-medium text-slate-900">Run Prediction Model</p>
                <p className="text-xs text-slate-500 mt-1">Generate predictions for upcoming races</p>
              </button>
            </form>
            <form action="/api/admin/backtest" method="POST">
              <button type="submit" className="w-full text-left px-4 py-3 rounded-lg border border-slate-200 hover:bg-slate-50 transition">
                <p className="font-medium text-slate-900">Run Backtest</p>
                <p className="text-xs text-slate-500 mt-1">Score predictions against actual results</p>
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
