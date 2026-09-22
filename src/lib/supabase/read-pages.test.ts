import { expect, it, vi } from 'vitest'
import { readPages } from './read-pages'

it('uses keyset pages through the final partial page without losing records', async () => {
  const load = vi.fn().mockResolvedValueOnce({ data: [{ id: 'a' }, { id: 'b' }], error: null })
    .mockResolvedValueOnce({ data: [{ id: 'c' }], error: null })
  expect(await readPages(load, 2)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  expect(load.mock.calls).toEqual([[null, 2], ['b', 2]])
})

it('throws rather than returning a partial report after a failed page', async () => {
  const load = vi.fn().mockResolvedValueOnce({ data: [{ id: 'a' }], error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '42501' } })
  await expect(readPages(load, 1)).rejects.toEqual({ code: '42501' })
})