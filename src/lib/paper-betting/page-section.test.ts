import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPaperPageSection } from './page-section'
import { notFound, redirect } from 'next/navigation'

afterEach(() => vi.restoreAllMocks())

describe('paper page section failures', () => {
  it.each([notFound, () => redirect('/login')])('preserves Next.js control-flow exceptions', async (interrupt) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(loadPaperPageSection('wallet', async () => interrupt())).rejects.toThrow()
    expect(log).not.toHaveBeenCalled()
  })

  it('keeps a database timeout separate from a successful empty result', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = await loadPaperPageSection('wallet', async () => { throw { code: '57014', message: 'canceling statement due to statement timeout' } })
    const empty = await loadPaperPageSection('wallet', async () => null)
    expect(failed).toEqual({ ok: false, data: null })
    expect(empty).toEqual({ ok: true, data: null })
    expect(log).toHaveBeenCalledWith('Paper betting section unavailable', { section: 'wallet', code: '57014' })
  })

  it('does not reject healthy sections when another query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const [wallet, opportunities, shadow] = await Promise.all([
      loadPaperPageSection('wallet', async () => ({ bankroll: 45.6 })),
      loadPaperPageSection('opportunities', async () => { throw { code: '57014' } }),
      loadPaperPageSection('shadow', async () => ({ captured: 0 })),
    ])
    expect(wallet).toEqual({ ok: true, data: { bankroll: 45.6 } })
    expect(opportunities.ok).toBe(false)
    expect(shadow.ok).toBe(true)
  })

  it('does not log raw upstream error payloads', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await loadPaperPageSection('validation', async () => { throw new Error('upstream HTML and sensitive request details') })
    expect(log).toHaveBeenCalledWith('Paper betting section unavailable', { section: 'validation', code: 'unknown' })
  })
})