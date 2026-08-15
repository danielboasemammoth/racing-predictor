import { supabase } from '@/lib/supabase'
import Link from 'next/link'

async function getAdminStats() {
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
    accuracyLogs: accuracyCount || 0,
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
              <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
              <p className="text-sm text-slate-600 mt-1">Manage data ingestion and model runs</p>
            </div>
            <div className="flex gap-3">
              <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">Races</Link>
              <Link href="/accuracy" className="text-sm font-medium text-slate-600 hover:text-slate-900">Accuracy</Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-sm text-slate-600 mb-1">Races</div>
            <div className="text-2xl font-bold text-slate-900">{stats.races}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-sm text-slate-600 mb-1">Horses</div>
            <div className="text-2xl font-bold text-slate-900">{stats.horses}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-sm text-slate-600 mb-1">Entries</div>
            <div className="text-2xl font-bold text-slate-900">{stats.entries}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-sm text-slate-600 mb-1">Predictions</div>
            <div className="text-2xl font-bold text-slate-900">{stats.predictions}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-sm text-slate-600 mb-1">Accuracy Runs</div>
            <div className="text-2xl font-bold text-slate-900">{stats.accuracyLogs}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Data & Model Actions</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">Data Ingestion</h3>
              <p className="text-sm text-slate-600 mb-3">Scrape public race data or pull from API feeds into the database.</p>
              <form action="/api/admin/scrape" method="POST" className="space-y-2">
                <button type="submit" className="w-full bg-teal-700 text-white py-2.5 rounded-lg font-medium hover:bg-teal-800 text-sm">
                  Scrape Upcoming Races
                </button>
              </form>
              <form action="/api/admin/scrape-results" method="POST" className="mt-2">
                <button type="submit" className="w-full border border-slate-300 text-slate-700 py-2.5 rounded-lg font-medium hover:border-teal-700 text-sm">
                  Scrape Recent Results
                </button>
              </form>
            </div>

            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">Prediction Model</h3>
              <p className="text-sm text-slate-600 mb-3">Run the prediction model on all upcoming races.</p>
              <form action="/api/admin/predict" method="POST" className="space-y-2">
                <button type="submit" className="w-full bg-teal-700 text-white py-2.5 rounded-lg font-medium hover:bg-teal-800 text-sm">
                  Run Predictions
                </button>
              </form>
              <form action="/api/admin/backtest" method="POST" className="mt-2">
                <button type="submit" className="w-full border border-slate-300 text-slate-700 py-2.5 rounded-lg font-medium hover:border-teal-700 text-sm">
                  Backtest Completed Races
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Setup guide */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mt-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Setup Checklist</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <span className="text-slate-400">1.</span>
              <span className="text-slate-700">Create Supabase project at <a href="https://supabase.com/dashboard" className="text-teal-700 underline">supabase.com/dashboard</a></span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-400">2.</span>
              <span className="text-slate-700">Run <code className="bg-slate-100 px-1 rounded">supabase/schema.sql</code> in SQL Editor</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-400">3.</span>
              <span className="text-slate-700">Add Supabase env vars to Vercel: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-400">4.</span>
              <span className="text-slate-700">Enable Email auth in Supabase → Authentication → Providers</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-slate-400">5.</span>
              <span className="text-slate-700">Scrape races → Run predictions → Watch accuracy improve</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
