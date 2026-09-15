import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaperBettingPage from './page'
import { createClient } from '@/lib/supabase/server'
import { queryLatestOpportunities } from '@/lib/paper-betting/opportunities-query'
import { computeValidationReport } from '@/lib/paper-betting/validation-query'
import { loadPlaceShadowReport, summarizePlaceShadow } from '@/lib/paper-betting/place-shadow'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/components/site-nav', () => ({ SiteNav: () => null }))
vi.mock('./what-if-lab', () => ({ WhatIfLab: () => null }))
vi.mock('./bankroll-settings', () => ({ BankrollSettings: () => null }))
vi.mock('@/lib/paper-betting/opportunities-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/paper-betting/opportunities-query')>(), queryLatestOpportunities: vi.fn(),
}))
vi.mock('@/lib/paper-betting/validation-query', () => ({ computeValidationReport: vi.fn() }))
vi.mock('@/lib/paper-betting/place-shadow', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/paper-betting/place-shadow')>(), loadPlaceShadowReport: vi.fn(),
}))

const timeout = { code: '57014', message: 'canceling statement due to statement timeout' }
const query = {
  select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(), limit: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('React', React)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => query) } as unknown as Awaited<ReturnType<typeof createClient>>)
  query.maybeSingle.mockResolvedValue({ data: { id: 'account', starting_bankroll: 50, current_bankroll: 50, staking_method: 'flat-1pct' }, error: null })
  query.limit.mockResolvedValue({ data: [], error: null })
  vi.mocked(queryLatestOpportunities).mockResolvedValue([])
  vi.mocked(computeValidationReport).mockResolvedValue({ totalSettled: 0 } as Awaited<ReturnType<typeof computeValidationReport>>)
  vi.mocked(loadPlaceShadowReport).mockResolvedValue({ captured: 0, pending: 0, exclusions: {}, ...summarizePlaceShadow([]) })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('paper betting page under database timeouts', () => {
  it('renders the wallet when opportunities, validation, and shadow queries time out', async () => {
    vi.mocked(queryLatestOpportunities).mockRejectedValue(timeout)
    vi.mocked(computeValidationReport).mockRejectedValue(timeout)
    vi.mocked(loadPlaceShadowReport).mockRejectedValue(timeout)
    const html = renderToStaticMarkup(await PaperBettingPage())
    expect(html).toContain('Opportunities temporarily unavailable')
    expect(html).toContain('Model validation temporarily unavailable')
    expect(html).toContain('Prospective PLACE data temporarily unavailable')
    expect(html).toContain('Current Bankroll')
    expect(html).toContain('$50.00')
    expect(html).not.toContain('No qualifying bets right now')
    expect(html).not.toContain('Awaiting future race results')
  })

  it('does not show account setup or fabricated wallet values after a wallet timeout', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: timeout })
    const html = renderToStaticMarkup(await PaperBettingPage())
    expect(html).toContain('Wallet and bet history temporarily unavailable')
    expect(html).not.toContain('Set Up Paper Betting')
    expect(html).not.toContain('Current Bankroll')
    expect(html).toContain('No qualifying bets right now')
    expect(vi.mocked(computeValidationReport)).not.toHaveBeenCalled()
  })

  it('still shows setup when the database successfully confirms no account exists', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null })
    const html = renderToStaticMarkup(await PaperBettingPage())
    expect(html).toContain('Set Up Paper Betting')
    expect(html).not.toContain('temporarily unavailable')
  })
})