export async function withSupabaseReadRetry<Result extends { error: unknown; status?: number }>(
  load: () => PromiseLike<Result>, attempts = 3, delayMs = 1000,
): Promise<Result> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await load()
      const code = result.error && typeof result.error === 'object' && 'code' in result.error ? result.error.code : null
      const transient = result.status === 0 || result.status === 408 || result.status === 429
        || (result.status !== undefined && result.status >= 500) || code === '57014'
      if (!result.error || !transient || attempt === attempts) return result
    } catch (error) {
      if (attempt === attempts) throw error
    }
    await new Promise(resolve => setTimeout(resolve, delayMs * attempt))
  }
  throw new Error('Read retry attempts must be positive')
}