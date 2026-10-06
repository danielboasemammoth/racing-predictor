import { afterEach, expect, it, vi } from 'vitest'
import { readHomeMirror } from './home-snapshot-mirror'

afterEach(() => vi.unstubAllEnvs())

it('reads a genuine persisted home snapshot without querying Postgres', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.test')
  const snapshot = { generatedAt: '2026-10-01T00:00:00Z', data: { races: [], tabRaceIds: [], reliabilityByRace: {} } }
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot)))
  expect(await readHomeMirror(fetcher)).toEqual(snapshot)
  expect(fetcher.mock.calls[0][0]).toContain('/storage/v1/object/public/racing-reports/pages/v1/home.json')
})

it('rejects missing, malformed and oversized mirrors instead of claiming a successful empty page', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.test')
  for (const response of [new Response('', { status: 404 }), new Response('{}'), new Response('x'.repeat(1_900_001))]) {
    await expect(readHomeMirror(vi.fn().mockResolvedValue(response))).rejects.toThrow()
  }
})