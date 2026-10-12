import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PaperBettingPage from './page'
import LivePaperBettingPage from './live/page'
import { createClient } from '@/lib/supabase/server'
import { readPageSnapshot } from '@/lib/page-cache-reader'
import { queryLatestOpportunities } from '@/lib/paper-betting/opportunities-query'
import { computeValidationReport } from '@/lib/paper-betting/validation-query'
import { loadPlaceShadowReport, summarizePlaceShadow } from '@/lib/paper-betting/place-shadow'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/page-cache-reader', () => ({ readPageSnapshot: vi.fn() }))
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
  retry: vi.fn().mockReturnThis(),
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
  vi.mocked(readPageSnapshot).mockImplementation(async key => {
    const data = key === 'opportunities' ? await queryLatestOpportunities({} as never)
      : key === 'validation' ? { accountId: 'account', report: await computeValidationReport({} as never, 'account') }
      : await loadPlaceShadowReport({} as never)
    return { generatedAt: new Date().toISOString(), data }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('paper betting page under database timeouts', () => {
  it('shows full cached cash performance separately from conditional bonus credit', async () => {
    vi.mocked(readPageSnapshot).mockResolvedValue({ generatedAt: '2026-10-11T00:00:00Z', data: {
      accountId: 'account', report: { totalSettled: 10, windows: [{ label: 'All bets', netProfit: -20, roiPct: -20 }],
        markets: [{ label: 'WIN / all', n: 10, races: 8, expectedHitRate: 0.4, winRate: 0.3, roiPct: -20, netProfit: -20 }],
        policies: [], calibration: { brierScore: 0.2, logLoss: 0.5 } },
      bonusCredits: [{ betId: 'bonus', runnerName: 'Runner', status: 'LOST', credit: 10, cap: 50 }],
    } })
    const html = renderToStaticMarkup(await LivePaperBettingPage())
    expect(html).toContain('10 settled WIN/PLACE bets')
    expect(html).toContain('30.0%')
    expect(html).toContain('40.0%')
    expect(html).toContain('$-20.00')
    expect(html).toContain('$10.00 bonus credit')
    expect(html).toContain('Credits never increase cash bankroll or cash ROI')
  })

  it('links to the restored dashboard while keeping the simulator independent', async () => {
    const html = renderToStaticMarkup(await PaperBettingPage())
    expect(html).toContain('/paper-betting/live')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('renders legacy account data without inventing accuracy when the snapshot is missing', async () => {
    vi.mocked(readPageSnapshot).mockResolvedValue(null)
    const html = renderToStaticMarkup(await LivePaperBettingPage())
    expect(html).toContain('Live Paper Betting')
    expect(html).toContain('Current bankroll')
    expect(html).toContain('Performance snapshot unavailable')
    expect(html).toContain('/paper-betting/archive')
    expect(html).not.toContain('NaN')
  })

  it('keeps the restored page available during a wallet outage', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: timeout })
    vi.mocked(readPageSnapshot).mockResolvedValue(null)
    const html = renderToStaticMarkup(await LivePaperBettingPage())
    expect(html).toContain('Paper account temporarily unavailable')
    expect(html).toContain('Historical simulator')
  })

  it('renders the simulator without querying wallet or legacy reports during a database outage', async () => {
    vi.mocked(queryLatestOpportunities).mockRejectedValue(timeout)
    vi.mocked(computeValidationReport).mockRejectedValue(timeout)
    vi.mocked(loadPlaceShadowReport).mockRejectedValue(timeout)
    const html = renderToStaticMarkup(await PaperBettingPage())
    expect(html).toContain('Historical Simulator')
    expect(html).toContain('Loading historical report')
    expect(createClient).not.toHaveBeenCalled()
    expect(readPageSnapshot).not.toHaveBeenCalled()
    expect(html).not.toContain('Current Bankroll')
  })

  it('preserves a read-only archive link without exposing legacy setup controls', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: timeout })
    const html = renderToStaticMarkup(await PaperBettingPage())
    expect(html).toContain('/paper-betting/archive')
    expect(html).not.toContain('Set Up Paper Betting')
    expect(html).not.toContain('Current Bankroll')
    expect(html).toContain('No real or paper bets are placed')
    expect(vi.mocked(computeValidationReport)).not.toHaveBeenCalled()
  })

  it('defaults to 500 races, positive edge and over-50-percent top-three probability', async () => {
    query.maybeSingle.mockResolvedValue({ data: null, error: null })
    const html = renderToStaticMarkup(await PaperBettingPage())
    expect(html).toContain('<option selected="">500</option>')
    expect(html).toContain('value="50" selected="">&gt; 50%')
    expect(html).toContain('value="0" selected="">&gt; 0 pts')
    expect(html).toContain('WIN filters')
    expect(html).toContain('PLACE filters')
  })
})