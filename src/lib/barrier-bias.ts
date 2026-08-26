/**
 * Track/distance/field-size barrier-bias analysis (spec: "do not use barrier as a simple
 * universal feature - build historical barrier-bias analysis for track x distance x field size x
 * barrier percentile"). This is deliberately separate from prediction-v3.ts's per-horse
 * `barrierSuitability` feature (that one is about whether THIS horse historically runs well from
 * similar draws; this module is about whether particular draws outperform expectation at a given
 * track/distance/field-size combination regardless of which horse is in them).
 *
 * Track-specific bias is shrunk toward the wider global bias for that same distance/field-size/
 * barrier-third bucket (not just toward the track's own overall win rate), so a handful of lucky
 * results at a quiet country track can't look like a durable track bias - this is the concrete
 * mechanism for the spec's "apply shrinkage where sample sizes are small; do not overfit
 * track-specific bias" requirement.
 */
import { bucketize, distanceBand, fieldSizeBand, barrierThird, shrinkRate, MIN_CREDIBLE_SAMPLE, type BucketStats } from './reliability-analysis'

export interface BarrierBiasRow {
  racecourseId: string
  distanceM: number | null
  fieldSize: number
  barrier: number
  won: boolean
}

export interface BarrierBiasTable {
  /** Buckets keyed by distanceBand|fieldSizeBand|barrierThird, pooled across every track. */
  global: BucketStats[]
  /** Same bucket keys, computed per track and shrunk toward the matching global bucket. */
  byTrack: Record<string, BucketStats[]>
}

function barrierBucketKey(row: Pick<BarrierBiasRow, 'distanceM' | 'fieldSize' | 'barrier'>): string {
  return `${distanceBand(row.distanceM)}|${fieldSizeBand(row.fieldSize)}|${barrierThird(row.barrier, row.fieldSize)}`
}

export function buildBarrierBiasTable(rows: BarrierBiasRow[]): BarrierBiasTable {
  const global = bucketize(rows, barrierBucketKey, (row) => row.won)
  const globalByKey = new Map(global.map((bucket) => [bucket.label, bucket]))

  const rowsByTrack = new Map<string, BarrierBiasRow[]>()
  for (const row of rows) {
    const list = rowsByTrack.get(row.racecourseId) ?? []
    list.push(row)
    rowsByTrack.set(row.racecourseId, list)
  }

  const byTrack: Record<string, BucketStats[]> = {}
  for (const [racecourseId, trackRows] of rowsByTrack) {
    byTrack[racecourseId] = bucketize(trackRows, barrierBucketKey, (row) => row.won).map((bucket) => {
      // Shrink toward the bucket's own global rate (not the track's overall baseline), since
      // different tracks have different natural distance/field-size mixes.
      const baseline = globalByKey.get(bucket.label)?.shrunkStrikeRate ?? bucket.baseline
      const shrunkStrikeRate = shrinkRate(bucket.wins, bucket.n, baseline)
      return { ...bucket, baseline, shrunkStrikeRate, lift: shrunkStrikeRate - baseline }
    })
  }

  return { global, byTrack }
}

/** Looks up the barrier-bias lift (vs baseline strike rate) for one runner; 0 when there's no credible signal either way. */
export function barrierBiasLift(
  table: BarrierBiasTable,
  racecourseId: string,
  distanceM: number | null,
  fieldSize: number,
  barrier: number,
): number {
  const key = barrierBucketKey({ distanceM, fieldSize, barrier })
  const trackBucket = table.byTrack[racecourseId]?.find((bucket) => bucket.label === key)
  if (trackBucket && trackBucket.n >= MIN_CREDIBLE_SAMPLE) return trackBucket.lift
  const globalBucket = table.global.find((bucket) => bucket.label === key)
  return globalBucket?.significant ? globalBucket.lift : 0
}
