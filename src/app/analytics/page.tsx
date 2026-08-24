import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadReliabilityContext } from '@/lib/reliability-context'
import { reliabilityCalibrationBands } from '@/lib/reliability-score'
import type { BucketStats } from '@/lib/reliability-analysis'

export const dynamic = 'force-dynamic'

function BandTable({ title, description, buckets }: { title: string; description: string; buckets: BucketStats[] }) {
  const shown = buckets.filter((bucket) => bucket.n >= 5)
  if (!shown.length) return null

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4">Band</th>
              <th className="py-2 pr-4">Races</th>
              <th className="py-2 pr-4">Strike rate</th>
              <th className="py-2 pr-4">95% CI</th>
              <th className="py-2 pr-4">vs baseline</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((bucket) => (
              <tr key={bucket.label} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-medium text-slate-900">{bucket.label}</td>
                <td className="py-2 pr-4 text-slate-600">{bucket.n}</td>
                <td className="py-2 pr-4 text-slate-900">{(bucket.strikeRate * 100).toFixed(1)}%</td>
                <td className="py-2 pr-4 text-slate-500">{(bucket.ciLow * 100).toFixed(1)}-{(bucket.ciHigh * 100).toFixed(1)}%</td>
                <td className={`py-2 pr-4 font-semibold ${bucket.lift >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {bucket.lift >= 0 ? '+' : ''}{(bucket.lift * 100).toFixed(1)}pts{bucket.n < 30 ? ' (small sample)' : bucket.significant ? ' (significant)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const context = await loadReliabilityContext(supabase)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Model Analytics</h1>
            <p className="text-sm text-slate-600 mt-1">How the model has actually performed, broken down by the conditions that matter.</p>
          </div>
          <Link href="/" className="text-sm font-medium text-teal-700 hover:text-teal-800">← Home</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {!context ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-600">
            No analytics data published yet. Run <code className="rounded bg-slate-100 px-1.5 py-0.5">npx tsx --env-file=.env.local scripts/reliability-analysis.ts</code> to generate it.
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900">Overall</h2>
              <p className="mt-1 text-sm text-slate-600">
                Baseline winner strike rate across {context.history.length} completed races with a valid prediction: <span className="font-semibold text-slate-900">{(context.calibration.overallBaseline * 100).toFixed(1)}%</span>
              </p>
            </div>

            <BandTable
              title="Reliability Score calibration"
              description="Higher Reliability Score bands should show genuinely higher strike rates - this is the check that keeps the score honest (spec section 28)."
              buckets={reliabilityCalibrationBands(
                context.history.filter((row): row is typeof row & { probability: number; gap: number; agreeing: number; totalBaseModels: number } =>
                  typeof row.probability === 'number' && typeof row.gap === 'number' && typeof row.agreeing === 'number' && typeof row.totalBaseModels === 'number'),
                context.calibration,
              ).map((band) => ({
                label: band.label,
                n: band.n,
                wins: band.wins,
                strikeRate: band.strikeRate,
                ciLow: band.ciLow,
                ciHigh: band.ciHigh,
                shrunkStrikeRate: band.strikeRate,
                baseline: context.calibration.overallBaseline,
                lift: band.strikeRate - context.calibration.overallBaseline,
                significant: band.n >= 30 && (band.ciLow > context.calibration.overallBaseline || band.ciHigh < context.calibration.overallBaseline),
              }))}
            />

            <BandTable
              title="Model probability calibration"
              description="Does a selection predicted at ~30% actually win close to 30% of the time? This is what the Reliability Score's probability factor is built from."
              buckets={context.calibration.probability}
            />

            <BandTable
              title="Prediction separation (#1 vs #2 probability gap)"
              description="Whether the size of the lead over the second pick is itself predictive, independent of raw probability."
              buckets={context.calibration.gap}
            />

            <BandTable
              title="Multi-model agreement"
              description="Whether the models agreeing with each other on the top pick is itself predictive."
              buckets={context.calibration.agreement}
            />

            <div className="bg-white rounded-xl border border-slate-200 p-6 text-xs text-slate-500">
              Only probability, prediction gap, and model agreement are validated (they held up on a chronological
              holdout split of {context.history.length} historical races) and feed the production Reliability
              Score. Other dimensions analysed (distance, race type, field size, barrier, track, venue) did not
              reliably replicate out-of-sample yet - see scripts/reliability-analysis.ts for the full discovery report.
            </div>
          </>
        )}
      </main>
    </div>
  )
}
