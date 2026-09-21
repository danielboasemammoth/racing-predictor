import { readPageSnapshot } from '@/lib/page-cache-reader'
import type { AnalyticsSnapshot } from '@/lib/analytics-snapshot'
import { SnapshotStatus } from '@/components/snapshot-status'
import { SiteNav } from '@/components/site-nav'
import type { BucketStats } from '@/lib/reliability-analysis'
import type { FlatStakeReport } from '@/lib/roi-analysis'

export const dynamic = 'force-dynamic'

function BaselineRow({ label, report }: { label: string; report: FlatStakeReport }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="py-2 pr-4 font-medium text-slate-900">{label}</td>
      <td className="py-2 pr-4 text-slate-600">{report.bets}</td>
      <td className="py-2 pr-4 text-slate-900">{(report.winRate * 100).toFixed(1)}%</td>
      <td className={`py-2 pr-4 font-semibold ${report.roi >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
        {report.roi >= 0 ? '+' : ''}{(report.roi * 100).toFixed(1)}%
      </td>
    </tr>
  )
}

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
  const snapshot = await readPageSnapshot<AnalyticsSnapshot>('analytics')
  const context = snapshot?.data
  const baselines = context?.baselines
  const featureImportance = context?.featureImportance

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Model Analytics</h1>
            <p className="text-sm text-slate-600 mt-1">How the model has actually performed, broken down by the conditions that matter.</p>
          </div>
          <SiteNav />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <SnapshotStatus generatedAt={snapshot?.generatedAt} />
        {!context ? null : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h2 className="text-lg font-semibold text-slate-900">Overall</h2>
              <p className="mt-1 text-sm text-slate-600">
                Baseline winner strike rate across {context.historyCount} completed races with a valid prediction: <span className="font-semibold text-slate-900">{(context.calibration.overallBaseline * 100).toFixed(1)}%</span>
              </p>
            </div>

            {baselines && (baselines.favourite.bets > 0 || baselines.model.bets > 0) && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900">Baseline comparison</h2>
                <p className="mt-1 text-sm text-slate-600">
                  How the model&apos;s own pick compares with simply backing the lowest-priced runner in Racing.com&apos;s recorded odds
                  (not a confirmed TAB/Betfair favourite - no market data access). Winner accuracy and profitability are different
                  questions: a high strike rate can still lose money, and a lower strike rate can still turn a profit.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                        <th className="py-2 pr-4">Strategy</th>
                        <th className="py-2 pr-4">Races</th>
                        <th className="py-2 pr-4">Win rate</th>
                        <th className="py-2 pr-4">Flat-stake ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      <BaselineRow label="Recorded favourite" report={baselines.favourite} />
                      <BaselineRow label="Model's top pick" report={baselines.model} />
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {featureImportance && featureImportance.featureImportance.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900">Feature importance</h2>
                <p className="mt-1 text-sm text-slate-600">
                  What happens to accuracy on held-out races when one feature group is switched off (spec section 34) - a bigger drop means that
                  feature matters more. Based on {featureImportance.racesEvaluated} races.
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  {featureImportance.featureImportance.map((row) => (
                    <li key={row.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <span className="text-slate-800">{row.label.replace(/^no-/, 'Removing ')}</span>
                      <span className={`font-semibold ${row.deltaVsFull < -0.001 ? 'text-red-700' : row.deltaVsFull > 0.001 ? 'text-slate-400' : 'text-slate-500'}`}>
                        {row.deltaVsFull >= 0 ? '+' : ''}{row.deltaVsFull.toFixed(4)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  Negative = removing this feature hurts accuracy (it&apos;s pulling real weight). Near zero = this feature currently contributes
                  little either way in this dataset.
                </p>
              </div>
            )}

            <BandTable
              title="Reliability Score calibration"
              description="Higher Reliability Score bands should show genuinely higher strike rates - this is the check that keeps the score honest (spec section 28)."
              buckets={context.bands}
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
              holdout split of {context.historyCount} historical races) and feed the production Reliability
              Score. Other dimensions analysed (distance, race type, field size, barrier, track, venue) did not
              reliably replicate out-of-sample yet - see scripts/reliability-analysis.ts for the full discovery report.
            </div>
          </>
        )}
      </main>
    </div>
  )
}
