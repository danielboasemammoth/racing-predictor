import type { SupabaseClient } from '@supabase/supabase-js'

export interface PredictionSnapshotRow {
  race_id: string
  model_version: string
  predictions: unknown
  confidence_scores: unknown
  predicted_times: unknown
  predicted_at: string
}

export async function insertPredictionSnapshots(db: SupabaseClient, rows: PredictionSnapshotRow[]) {
  for (let offset = 0; offset < rows.length; offset += 20) {
    const { error } = await db.from('predictions').insert(rows.slice(offset, offset + 20))
    if (error) throw error
  }
}