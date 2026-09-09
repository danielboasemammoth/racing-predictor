/**
 * Segment Explorer (reliability spec sections 21/22/23/45): surfaces the tiered historical
 * segmentation this project already computes (src/lib/reliability-analysis.ts's bucketize(),
 * published by scripts/reliability-analysis.ts into analysis_snapshots kind='race-feature-history')
 * as a browsable admin/research page. Every table reuses the SAME tested statistics
 * (summarizeBucket: Wilson 95% CI, empirical-Bayes shrinkage, MIN_CREDIBLE_SAMPLE=30 significance
 * gate) that already power the Reliability Score and similar-races.ts - no new statistics logic
 * is introduced here, only a new read-only view of it. Admin-gated like the rest of /admin;
 * read-only, does not affect production scoring or any live prediction.
 */
import { hasAdminSession, isAdminConfigured } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SiteNav } from '@/components/site-nav'
import {
  MIN_CREDIBLE_SAMPLE,
  agreementBand,
  bucketize,
  distanceBand,
  fieldSizeBand,
  marketImpliedProbability,
  modelEdge,
  modelEdgeBand,
  predictionGapBand,
  probabilityBand,
  type BucketStats,
} from '@/lib/reliability-analysis'
import type { HistoricalRaceFeatures } from '@/lib/similar-races'

export const dynamic = 'force-dynamic'

interface HistoryPayload {
  generatedAt: string
  rows: HistoricalRaceFeatures[]
}

async function loadHistory(): Promise<HistoryPayload | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('analysis_snapshots')
    .select('payload')
    .eq('kind', 'race-feature-history')
    .maybeSingle()
  if (error || !data) return null
  return data.payload as HistoryPayload
}

function withOdds(rows: HistoricalRaceFeatures[]) {
  return rows.filter((row): row is HistoricalRaceFeatures & { bestRecordedOdds: number; probability: number } =>
    Boolean(row.bestRecordedOdds) && typeof row.probability === 'number')
}

export default async function ResearchPage() {
  const configured = isAdminConfigured()
  const authenticated = configured && await hasAdminSession()

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-3xl mx-auto px-4 py-6 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-slate-900">Segment Explorer</h1>
            <SiteNav />
          </div>
        </header>
        <main className="max-w-md mx-auto px-4 py-16">
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <p className="text-sm text-slate-600">Sign in via <a href="/admin" className="text-teal-700 underline">/admin</a> first.</p>
          </div>
        </main>
      </div>
    )
  }

  const history = await loadHistory()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Segment Explorer</h1>
            <p className="text-sm text-slate-600 mt-1">Where the production model actually performs better or worse than baseline, by historical race segment.</p>
          </div>
          <SiteNav />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {!history ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <p className="text-sm text-slate-600">
              No segmentation data published yet - run <code className="bg-slate-100 px-1 rounded">npx tsx --env-file=.env.local scripts/reliability-analysis.ts</code> to publish it.
            </p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <p className="text-sm text-slate-600">
                {history.rows.length} historical races analyzed &middot; last published {new Date(history.generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}
                &middot; minimum credible sample size = {MIN_CREDIBLE_SAMPLE} races (segments below this are shown but never flagged &ldquo;significant&rdquo; - spec sections 22/23)
              </p>
            </div>

            <SegmentTable title="Distance" buckets={bucketize(history.rows, (r) => distanceBand(r.distanceM), (r) => r.correctWinner)} />
            <SegmentTable title="Race type" buckets={bucketize(history.rows, (r) => r.raceType, (r) => r.correctWinner)} />
            <SegmentTable title="Field size" buckets={bucketize(history.rows, (r) => fieldSizeBand(r.fieldSize), (r) => r.correctWinner)} />
            <SegmentTable
              title="Barrier third"
              buckets={bucketize(history.rows.filter((r) => r.barrierThird), (r) => r.barrierThird!, (r) => r.correctWinner)}
            />
            <SegmentTable
              title="Track condition"
              buckets={bucketize(history.rows.filter((r) => r.trackCondition), (r) => r.trackCondition!, (r) => r.correctWinner)}
            />
            <SegmentTable
              title="Model probability (confidence band)"
              buckets={bucketize(history.rows.filter((r) => typeof r.probability === 'number'), (r) => probabilityBand(r.probability!), (r) => r.correctWinner)}
            />
            <SegmentTable
              title="Prediction gap (Top1 vs Top2 - separation)"
              buckets={bucketize(history.rows.filter((r) => typeof r.gap === 'number'), (r) => predictionGapBand(r.gap!), (r) => r.correctWinner)}
            />
            <SegmentTable
              title="Model consensus (agreement across base models)"
              buckets={bucketize(
                history.rows.filter((r) => typeof r.agreeing === 'number' && typeof r.totalBaseModels === 'number'),
                (r) => agreementBand(r.agreeing!, r.totalBaseModels!),
                (r) => r.correctWinner,
              )}
            />
            <SegmentTable
              title="Model Edge vs market (odds band)"
              buckets={bucketize(
                withOdds(history.rows),
                (r) => modelEdgeBand(modelEdge(r.probability, marketImpliedProbability(r.bestRecordedOdds))),
                (r) => r.correctWinner,
              )}
            />
          </>
        )}
      </main>
    </div>
  )
}

function SegmentTable({ title, buckets }: { title: string; buckets: BucketStats[] }) {
  const shown = buckets.filter((bucket) => bucket.n >= 5)
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">{title}</h2>
      {!shown.length ? (
        <p className="text-sm text-slate-500">Not enough data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4">Segment</th>
                <th className="py-2 pr-4">N</th>
                <th className="py-2 pr-4">Strike rate</th>
                <th className="py-2 pr-4">95% CI</th>
                <th className="py-2 pr-4">Baseline</th>
                <th className="py-2 pr-4">Lift</th>
                <th className="py-2">Signal</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((bucket) => (
                <tr key={bucket.label} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4 font-medium text-slate-900">{bucket.label}</td>
                  <td className="py-2 pr-4 text-slate-700">{bucket.n}</td>
                  <td className="py-2 pr-4 text-slate-700">{(bucket.strikeRate * 100).toFixed(1)}%</td>
                  <td className="py-2 pr-4 text-slate-500">{(bucket.ciLow * 100).toFixed(1)}-{(bucket.ciHigh * 100).toFixed(1)}%</td>
                  <td className="py-2 pr-4 text-slate-500">{(bucket.baseline * 100).toFixed(1)}%</td>
                  <td className={`py-2 pr-4 font-medium ${bucket.lift > 0 ? 'text-emerald-700' : bucket.lift < 0 ? 'text-red-700' : 'text-slate-700'}`}>
                    {bucket.lift >= 0 ? '+' : ''}{(bucket.lift * 100).toFixed(1)}pts
                  </td>
                  <td className="py-2">
                    {bucket.n < MIN_CREDIBLE_SAMPLE ? (
                      <span className="text-xs text-slate-400">small sample</span>
                    ) : bucket.significant ? (
                      <span className={`text-xs font-semibold ${bucket.lift > 0 ? 'text-emerald-700' : 'text-red-700'}`}>significant</span>
                    ) : (
                      <span className="text-xs text-slate-400">not significant</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
