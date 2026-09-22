import { withSupabaseReadRetry } from './read-retry'

export async function readPages<Row extends { id: string }>(
  load: (after: string | null, limit: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  pageSize = 250,
): Promise<Row[]> {
  const rows: Row[] = []
  let after: string | null = null
  for (;;) {
    const result = await withSupabaseReadRetry(() => load(after, pageSize))
    if (result.error) throw result.error
    const page = result.data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
    const next = page[page.length - 1].id
    if (next === after) throw new Error('Historical query cursor did not advance')
    after = next
  }
}