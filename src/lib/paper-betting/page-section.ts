import { unstable_rethrow } from 'next/navigation'

export type PageSectionResult<Value> = { ok: true; data: Value } | { ok: false; data: null }

export async function loadPaperPageSection<Value>(section: string, load: () => Promise<Value>): Promise<PageSectionResult<Value>> {
  try {
    return { ok: true, data: await load() }
  } catch (error) {
    unstable_rethrow(error)
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
    console.error('Paper betting section unavailable', { section, code })
    return { ok: false, data: null }
  }
}