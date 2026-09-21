import type { SupabaseClient } from '@supabase/supabase-js'

export interface PageSnapshot<Value> {
  generatedAt: string
  data: Value
}

export interface PageSnapshotStore {
  read<Value>(key: string): Promise<PageSnapshot<Value> | null>
  publish<Value>(key: string, snapshot: PageSnapshot<Value>): Promise<void>
}

export function createPageSnapshotStore(db: SupabaseClient): PageSnapshotStore {
  const kind = (key: string) => `page-cache-v1:${key}`
  return {
    async read<Value>(key: string) {
      const result = await db.from('analysis_snapshots').select('payload, generated_at').eq('kind', kind(key)).retry(false).maybeSingle()
      if (result.error) throw result.error
      return result.data ? { generatedAt: result.data.generated_at, data: result.data.payload as Value } : null
    },
    async publish<Value>(key: string, snapshot: PageSnapshot<Value>) {
      const row = { kind: kind(key), payload: snapshot.data, generated_at: snapshot.generatedAt }
      const updated = await db.from('analysis_snapshots').update(row).eq('kind', row.kind)
        .lt('generated_at', snapshot.generatedAt).select('id')
      if (updated.error) throw updated.error
      if (!updated.data?.length) {
        const inserted = await db.from('analysis_snapshots').upsert(row, { onConflict: 'kind', ignoreDuplicates: true })
        if (inserted.error) throw inserted.error
      }
    },
  }
}

export function createPageSnapshotReader(store: PageSnapshotStore, ttlMs = 30_000) {
  const values = new Map<string, { checkedAt: number; snapshot: PageSnapshot<unknown> | null }>()
  const pending = new Map<string, Promise<PageSnapshot<unknown> | null>>()
  return async function read<Value>(key: string): Promise<PageSnapshot<Value> | null> {
    const previous = values.get(key)
    if (previous && Date.now() - previous.checkedAt < ttlMs) return previous.snapshot as PageSnapshot<Value> | null
    let request = pending.get(key)
    if (!request) {
      request = (async () => {
        let snapshot = previous?.snapshot ?? null
        try {
          const stored = await store.read(key)
          if (stored && (!snapshot || stored.generatedAt >= snapshot.generatedAt)) snapshot = stored
        } catch {
          console.error('Page snapshot read unavailable', { key })
        }
        values.set(key, { checkedAt: Date.now(), snapshot })
        return snapshot
      })().finally(() => pending.delete(key))
      pending.set(key, request)
    }
    return await request as PageSnapshot<Value> | null
  }
}

export async function refreshPageSnapshot<Value>(store: PageSnapshotStore, key: string, load: () => Promise<Value>) {
  const generatedAt = new Date().toISOString()
  const data = await load()
  await store.publish(key, { generatedAt, data })
}