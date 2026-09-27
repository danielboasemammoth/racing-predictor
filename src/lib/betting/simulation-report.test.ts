import { expect, it, vi } from 'vitest'
import { readSimulationChunks, readSimulationManifest, type SimulationManifest } from './simulation-report'

const manifest: SimulationManifest = { schema: 1, generatedAt: '2026-09-26T00:00:00Z', models: [], chunks: [`simulator/v1/${'a'.repeat(64)}.json`], races: [{ id: 'race', fingerprint: 'hash' }] }

it('loads a complete report from storage without a database client', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(manifest)).mockResolvedValueOnce(Response.json([{ id: 'race', selections: [] }]))
  const loaded = await readSimulationManifest('https://example.test/', fetcher)
  expect(await readSimulationChunks('https://example.test/', loaded!, fetcher)).toMatchObject({ races: [{ id: 'race' }], generatedAt: manifest.generatedAt })
})

it('rejects partial datasets and unsafe chunk paths', async () => {
  await expect(readSimulationChunks('https://example.test/', manifest, vi.fn<typeof fetch>().mockResolvedValue(Response.json([])))).rejects.toThrow('Incomplete')
  await expect(readSimulationManifest('https://example.test/', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...manifest, chunks: ['../private'] })))).rejects.toThrow('Invalid')
})

it('distinguishes a missing report from provider failures', async () => {
  expect(await readSimulationManifest('https://example.test/', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 })))).toBeNull()
  await expect(readSimulationManifest('https://example.test/', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 522 })))).rejects.toThrow('522')
})