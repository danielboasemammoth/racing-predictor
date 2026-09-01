import type {
  NextToGoParams,
  PeNextToGoRace,
  PeRaceResult,
  PeUsage,
  RacingCategory,
  ResultsParams,
} from '@/lib/puntersedge/types'

const BASE_URL = 'https://api.puntersedge.online/v1'
const DEMO_BASE_URL = 'https://api.puntersedge.online/v1/demo'

export class PuntersEdgeAuthError extends Error {}
export class PuntersEdgeCreditsExhaustedError extends Error {}
export class PuntersEdgeValidationError extends Error {
  constructor(message: string, public readonly fields: unknown) {
    super(message)
  }
}
export class PuntersEdgeRateLimitError extends Error {
  constructor(message: string, public readonly retryAfterSeconds: number) {
    super(message)
  }
}
export class PuntersEdgeServerError extends Error {}

interface ProblemJson {
  type?: string
  title?: string
  status?: number
  detail?: string | unknown[] | Record<string, unknown>
}

function detailToMessage(detail: ProblemJson['detail']): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((entry) => JSON.stringify(entry)).join('; ')
  if (detail && typeof detail === 'object') {
    const obj = detail as Record<string, unknown>
    return typeof obj.message === 'string' ? obj.message : JSON.stringify(detail)
  }
  return 'Unknown error'
}

export interface PuntersEdgeClientOptions {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  maxRetries?: number
}

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

function categoriesParam(categories?: RacingCategory[]): string | undefined {
  return categories && categories.length > 0 ? categories.join(',') : undefined
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Thin, typed abstraction over the PuntersEdge REST API. Handles auth, retry/backoff (per the
 * documented error contract: 402 never retries, 429 honours Retry-After, 5xx/503 back off), and
 * falls back to the unauthenticated /v1/demo/* sandbox for next-to-go/best-odds when no API key
 * is configured, so the integration can be built/tested without a paid or free key.
 */
export class PuntersEdgeClient {
  private readonly apiKey: string | undefined
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly sleepImpl: (ms: number) => Promise<void>
  private readonly maxRetries: number

  constructor(options: PuntersEdgeClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.PUNTERSEDGE_API_KEY
    this.baseUrl = options.baseUrl ?? BASE_URL
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleepImpl = options.sleepImpl ?? defaultSleep
    this.maxRetries = options.maxRetries ?? 3
  }

  get isDemoMode(): boolean {
    return !this.apiKey
  }

  private async request<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const demo = this.isDemoMode
    const url = `${demo ? DEMO_BASE_URL : this.baseUrl}${path}${toQueryString(params)}`
    const headers: Record<string, string> = demo ? {} : { 'X-API-Key': this.apiKey! }

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.fetchImpl(url, { headers })

      if (response.ok) {
        return (await response.json()) as T
      }

      let problem: ProblemJson = {}
      try {
        problem = (await response.json()) as ProblemJson
      } catch {
        // Non-JSON error body - fall through with an empty problem object.
      }
      const message = detailToMessage(problem.detail) || problem.title || `HTTP ${response.status}`

      if (response.status === 401) throw new PuntersEdgeAuthError(message)
      if (response.status === 402) throw new PuntersEdgeCreditsExhaustedError(message)
      if (response.status === 422) throw new PuntersEdgeValidationError(message, problem.detail)

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '60')
        if (attempt >= this.maxRetries) throw new PuntersEdgeRateLimitError(message, retryAfter)
        await this.sleepImpl(retryAfter * 1000)
        continue
      }

      if (response.status >= 500) {
        if (attempt >= this.maxRetries) throw new PuntersEdgeServerError(message)
        await this.sleepImpl(2 ** attempt * 1000)
        continue
      }

      throw new Error(`PuntersEdge request failed: HTTP ${response.status} ${message}`)
    }

    throw new PuntersEdgeServerError('Exhausted retries')
  }

  /** GET /v1/racing/next-to-go (2cr) - falls back to /v1/demo/racing/next-to-go when no key is configured. */
  async nextToGo(params: NextToGoParams = {}): Promise<PeNextToGoRace[]> {
    if (this.isDemoMode) {
      const demoPayload = await this.request<{ races: PeNextToGoRace[] }>('/racing/next-to-go')
      return demoPayload.races ?? []
    }
    return this.request<PeNextToGoRace[]>('/racing/next-to-go', {
      num_races: params.numRaces,
      categories: categoriesParam(params.categories),
      bookmakers: params.bookmakers?.join(','),
      country: params.country?.join(','),
      venue: params.venue?.join(','),
      include_unresolved: params.includeUnresolved,
    })
  }

  /** GET /v1/racing/results (2cr). Requires a real API key - not available in the sandbox. */
  async results(params: ResultsParams = {}): Promise<PeRaceResult[]> {
    if (this.isDemoMode) throw new PuntersEdgeAuthError('PUNTERSEDGE_API_KEY is not configured - results require a real key')
    return this.request<PeRaceResult[]>('/racing/results', {
      hours_back: params.hoursBack,
      date: params.date,
      categories: categoriesParam(params.categories),
      venue: params.venue,
      country: params.country?.join(','),
      status: params.status,
      limit: params.limit,
      offset: params.offset,
    })
  }

  /** GET /v1/usage - free, current billing period + all-time credit usage. Requires a real key. */
  async usage(): Promise<PeUsage> {
    if (this.isDemoMode) throw new PuntersEdgeAuthError('PUNTERSEDGE_API_KEY is not configured')
    return this.request<PeUsage>('/usage')
  }
}

let sharedClient: PuntersEdgeClient | null = null

/** Process-wide singleton so admin routes share one client instance (and its retry/backoff state). */
export function getPuntersEdgeClient(): PuntersEdgeClient {
  if (!sharedClient) sharedClient = new PuntersEdgeClient()
  return sharedClient
}
