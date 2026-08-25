import { AdminActions } from './admin-actions'
import { CsvImporter } from './csv-importer'
import { login, logout } from './actions'
import { hasAdminSession, isAdminConfigured } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SiteNav } from '@/components/site-nav'

export const dynamic = 'force-dynamic'

async function getAdminStats() {
  const supabase = createAdminClient()
  const results = await Promise.all([
    supabase.from('races').select('*', { count: 'exact', head: true }),
    supabase.from('horses').select('*', { count: 'exact', head: true }),
    supabase.from('race_entries').select('*', { count: 'exact', head: true }),
    supabase.from('predictions').select('*', { count: 'exact', head: true }),
    supabase.from('accuracy_log').select('*', { count: 'exact', head: true }),
  ])
  const queryError = results.find((result) => result.error)?.error
  if (queryError) throw queryError
  const [races, horses, entries, predictions, accuracy] = results

  return {
    races: races.count || 0,
    horses: horses.count || 0,
    entries: entries.count || 0,
    predictions: predictions.count || 0,
    accuracy: accuracy.count || 0,
  }
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const configured = isAdminConfigured()
  const authenticated = configured && await hasAdminSession()
  const { error } = await searchParams

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-slate-900">Admin Access</h1>
            <SiteNav />
          </div>
        </header>
        <main className="max-w-md mx-auto px-4 py-16">
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            {!configured ? (
              <div>
                <h2 className="font-semibold text-slate-900">Admin access is not configured</h2>
                <p className="text-sm text-slate-600 mt-2">Set the server-only ADMIN_API_KEY environment variable to enable admin operations.</p>
              </div>
            ) : (
              <form action={login} className="space-y-4">
                <div>
                  <label htmlFor="admin-key" className="block text-sm font-medium text-slate-800 mb-1">Admin key</label>
                  <input
                    id="admin-key"
                    name="key"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
                  />
                </div>
                {error === 'invalid' && <p className="text-sm text-red-700">The admin key is incorrect.</p>}
                <button type="submit" className="w-full rounded-lg bg-teal-700 px-4 py-2.5 font-medium text-white hover:bg-teal-800">
                  Sign in
                </button>
              </form>
            )}
          </div>
        </main>
      </div>
    )
  }

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
            <div className="flex items-center gap-4">
              <form action={logout}>
                <button type="submit" className="text-sm font-medium text-slate-600 hover:text-slate-900">Sign out</button>
              </form>
              <SiteNav />
            </div>
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
          <AdminActions />
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Victoria Race CSV Importer</h2>
          <CsvImporter />
        </div>
      </main>
    </div>
  )
}
