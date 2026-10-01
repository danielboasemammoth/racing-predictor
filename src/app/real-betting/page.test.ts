import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RealBettingPage from './page'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), configured: vi.fn(), load: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/admin-auth', () => ({ hasAdminSession: mocks.auth, isAdminConfigured: mocks.configured }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.client }))
vi.mock('@/lib/real-betting/ledger', () => ({ loadRealBettingLedger: mocks.load }))
vi.mock('@/components/site-nav', () => ({ SiteNav: () => null }))
vi.mock('./strategy-draft', () => ({ StrategyDraft: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('React', React)
  mocks.configured.mockReturnValue(true)
  mocks.auth.mockResolvedValue(true)
})
afterEach(() => { vi.unstubAllGlobals() })

it('does not read the ledger for visitors', async () => {
  mocks.auth.mockResolvedValue(false)
  const html = renderToStaticMarkup(await RealBettingPage())
  expect(html).toContain('TAB provider: not connected')
  expect(html).toContain('Ledger history is admin-only')
  expect(mocks.load).not.toHaveBeenCalled()
})

it('shows a pending migration instead of failing', async () => {
  mocks.load.mockResolvedValue({ status: 'migration-pending' })
  expect(renderToStaticMarkup(await RealBettingPage())).toContain('migrate-real-betting.sql')
})

it('shows honest empty ledger state and only verified outcomes', async () => {
  mocks.load.mockResolvedValue({ status: 'ready', attempts: [], bets: [{
    id: 'b', provider: 'tab', provider_order_id: null, strategy_name: 'S', race_ref: 'r', selection_ref: 's', market: 'WIN', quoted_odds: 3, stake: 5,
    currency: 'AUD', status: 'PENDING_SUBMISSION', outcome: null, return_amount: null, settlement_verified_at: null, created_at: '2026-10-01T00:00:00Z',
  }] })
  const html = renderToStaticMarkup(await RealBettingPage())
  expect(html).toContain('No dry-run attempts recorded')
  expect(html).toContain('Unverified')
})

it('degrades when the ledger client throws', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.load.mockRejectedValue(new Error('boom'))
  expect(renderToStaticMarkup(await RealBettingPage())).toContain('could not be read')
})
