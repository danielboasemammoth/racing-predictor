import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

const BATCH_SIZE = 5000
// Caps how many batches this single call processes - a huge one-off backlog (hundreds of
// thousands of rows) takes many batches to fully drain, and looping too many in one HTTP request
// risks hitting the platform's own upstream request timeout (a separate, shorter ceiling than
// Postgres's statement_timeout - the batching itself already works around that one). Call this
// route repeatedly (the daily pipeline does, and so does the admin action) until it reports
// drained:true.
const MAX_BATCHES_PER_CALL = 6

async function drainBatches(admin: SupabaseClient, rpcName: string): Promise<{ deleted: number; drained: boolean }> {
  let deleted = 0
  for (let i = 0; i < MAX_BATCHES_PER_CALL; i += 1) {
    const { data, error } = await admin.rpc(rpcName, { batch_size: BATCH_SIZE })
    if (error) throw error
    const batchDeleted = data as number
    deleted += batchDeleted
    if (batchDeleted < BATCH_SIZE) return { deleted, drained: true }
  }
  return { deleted, drained: false }
}

/**
 * Prunes pe_recommendations/pe_odds_snapshots down to just the latest row per runner via the
 * prune_stale_pe_recommendations/prune_stale_pe_odds_snapshots SQL functions (see
 * supabase/migrate-prune-stale-pe-data.sql) - both tables write a fresh row per runner on every
 * ~15min poll, and live reads only ever look at the last 30 minutes, so older snapshots are pure
 * bloat. Never deletes a recommendation referenced by an existing paper bet. Processes up to
 * MAX_BATCHES_PER_CALL batches per table per call - `drained: false` in the response means a large
 * backlog remains and this should be called again.
 */
export async function POST() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  try {
    const [recommendations, oddsSnapshots] = await Promise.all([
      drainBatches(admin, 'prune_stale_pe_recommendations'),
      drainBatches(admin, 'prune_stale_pe_odds_snapshots'),
    ])
    const drained = recommendations.drained && oddsSnapshots.drained

    return NextResponse.json({
      success: true,
      recommendationsDeleted: recommendations.deleted,
      oddsSnapshotsDeleted: oddsSnapshots.deleted,
      drained,
      message: `Pruned ${recommendations.deleted} stale recommendation${recommendations.deleted === 1 ? '' : 's'} and ${oddsSnapshots.deleted} stale odds snapshot${oddsSnapshots.deleted === 1 ? '' : 's'}${drained ? ' - fully drained' : ' - large backlog remains, run again'}`,
    })
  } catch (error) {
    console.error('Prune stale PuntersEdge data failed', error)
    const message = error instanceof Error ? error.message : 'Prune failed'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
