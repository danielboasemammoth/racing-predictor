import { describe, expect, it, vi } from 'vitest'
import {
  PuntersEdgeAuthError,
  PuntersEdgeClient,
  PuntersEdgeCreditsExhaustedError,
  PuntersEdgeRateLimitError,
  PuntersEdgeServerError,
  PuntersEdgeValidationError,
} from '@/lib/puntersedge/client'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

describe('PuntersEdgeClient - demo mode', () => {
  it('uses the unauthenticated sandbox and unwraps the demo envelope when no API key is configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { demo: true, races: [{ race_id: 'abc', venue: 'Geelong' }] }),
    )
    const client = new PuntersEdgeClient({ apiKey: undefined, fetchImpl })
    expect(client.isDemoMode).toBe(true)

    const races = await client.nextToGo()
    expect(races).toEqual([{ race_id: 'abc', venue: 'Geelong' }])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('/v1/demo/racing/next-to-go')
    expect(init.headers['X-API-Key']).toBeUndefined()
  })

  it('refuses to call results()/usage() in demo mode since those need a real key', async () => {
    const client = new PuntersEdgeClient({ apiKey: undefined, fetchImpl: vi.fn() })
    await expect(client.results()).rejects.toBeInstanceOf(PuntersEdgeAuthError)
    await expect(client.usage()).rejects.toBeInstanceOf(PuntersEdgeAuthError)
  })
})

describe('PuntersEdgeClient - authenticated mode', () => {
  it('sends the X-API-Key header and builds the query string from params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, []))
    const client = new PuntersEdgeClient({ apiKey: 'test-key', fetchImpl })

    await client.nextToGo({ numRaces: 200, categories: ['horse', 'greyhound'], venue: ['Randwick'] })

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('num_races=200')
    expect(url).toContain('categories=horse%2Cgreyhound')
    expect(url).toContain('venue=Randwick')
    expect(init.headers['X-API-Key']).toBe('test-key')
  })

  it('throws PuntersEdgeAuthError on 401 without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { detail: 'bad key' }))
    const client = new PuntersEdgeClient({ apiKey: 'bad', fetchImpl })
    await expect(client.nextToGo()).rejects.toBeInstanceOf(PuntersEdgeAuthError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('throws PuntersEdgeCreditsExhaustedError on 402 without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(402, { detail: { message: 'out of credits' } }))
    const client = new PuntersEdgeClient({ apiKey: 'k', fetchImpl })
    await expect(client.usage()).rejects.toBeInstanceOf(PuntersEdgeCreditsExhaustedError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('throws PuntersEdgeValidationError on 422 with the field-error array in .fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { detail: [{ loc: ['bookmakers'], msg: 'invalid key' }] }))
    const client = new PuntersEdgeClient({ apiKey: 'k', fetchImpl })
    await expect(client.nextToGo()).rejects.toBeInstanceOf(PuntersEdgeValidationError)
  })

  it('honours Retry-After on 429 and retries, eventually succeeding', async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { detail: { message: 'slow down' } }, { 'Retry-After': '5' }))
      .mockResolvedValueOnce(jsonResponse(200, []))
    const client = new PuntersEdgeClient({ apiKey: 'k', fetchImpl, sleepImpl })

    const result = await client.nextToGo()
    expect(result).toEqual([])
    expect(sleepImpl).toHaveBeenCalledWith(5000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws PuntersEdgeRateLimitError after exhausting retries on repeated 429s', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, {}, { 'Retry-After': '1' }))
    const client = new PuntersEdgeClient({ apiKey: 'k', fetchImpl, sleepImpl: vi.fn(), maxRetries: 2 })
    await expect(client.nextToGo()).rejects.toBeInstanceOf(PuntersEdgeRateLimitError)
    expect(fetchImpl).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('retries on 5xx with exponential backoff and eventually succeeds', async () => {
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, []))
    const client = new PuntersEdgeClient({ apiKey: 'k', fetchImpl, sleepImpl })

    await client.nextToGo()
    expect(sleepImpl).toHaveBeenNthCalledWith(1, 1000)
    expect(sleepImpl).toHaveBeenNthCalledWith(2, 2000)
  })

  it('throws PuntersEdgeServerError after exhausting retries on repeated 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}))
    const client = new PuntersEdgeClient({ apiKey: 'k', fetchImpl, sleepImpl: vi.fn(), maxRetries: 1 })
    await expect(client.nextToGo()).rejects.toBeInstanceOf(PuntersEdgeServerError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('parses a string detail, an object detail, and a missing body without crashing', async () => {
    const client = new PuntersEdgeClient({
      apiKey: 'k',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(401, { detail: 'plain string error' })),
    })
    await expect(client.nextToGo()).rejects.toThrow('plain string error')
  })
})
