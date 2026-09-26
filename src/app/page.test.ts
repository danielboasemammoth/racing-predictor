import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './page'
import { readPageSnapshot } from '@/lib/page-cache-reader'
import { loadHomeSnapshot } from '@/lib/page-snapshot-loaders'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUpcomingRaces } from '@/lib/upcoming-races'
import { loadReliabilityContext } from '@/lib/reliability-context'
import { getTabRaceIds } from '@/lib/tab-races'
import type { RaceWithPrediction } from '@/lib/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/page-cache-reader', () => ({ readPageSnapshot: vi.fn() }))
vi.mock('@/lib/upcoming-races', () => ({ getUpcomingRaces: vi.fn() }))
vi.mock('@/lib/reliability-context', () => ({ loadReliabilityContext: vi.fn() }))
vi.mock('@/lib/tab-races', () => ({ getTabRaceIds: vi.fn() }))
vi.mock('@/components/site-nav', () => ({ SiteNav: () => null }))
vi.mock('@/components/paper-bet-button', () => ({ PaperBetButton: () => null }))
vi.mock('@/components/picks-sort-filter', () => ({ PicksSortFilter: () => null }))

function fixture(): RaceWithPrediction {
  const horse = { horse_id: 'horse', horse_name: 'Place Candidate', predicted_position: 1, confidence: 0.2, win_probability: 0.2, top3_probability: 0.62 }
  return {
    id: 'race', racecourse_id: 'course', race_number: 1, status: 'upcoming', race_datetime: '2026-09-18T03:00:00Z',
    prediction: {
      id: 'prediction', race_id: 'race', model_version: 'v6-market-blend', predicted_at: '2026-09-16T20:00:00Z',
      predictions: { podium: [horse], all_horses: [horse] }, confidence_scores: { overall: 0.2 }, predicted_times: {},
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-17T00:00:00Z'))
  vi.stubGlobal('React', React)
  vi.mocked(getUpcomingRaces).mockResolvedValue([fixture()])
  vi.mocked(getTabRaceIds).mockResolvedValue(['race'])
  vi.mocked(loadReliabilityContext).mockResolvedValue({
    calibration: { overallBaseline: 0.18, probability: [], gap: [], agreement: [], rawRateRange: { min: 0.1, max: 0.3 } }, history: [],
  })
  vi.mocked(readPageSnapshot).mockImplementation(async () => ({ generatedAt: '2026-09-17T00:00:00Z', data: await loadHomeSnapshot({} as SupabaseClient) }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('homepage pick availability', () => {
  it('renders a clear cold-cache state without a live database fallback', async () => {
    vi.mocked(readPageSnapshot).mockResolvedValue(null)
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Page data temporarily unavailable')
    expect(getUpcomingRaces).not.toHaveBeenCalled()
  })
  it('shows tomorrow without the PLACE watchlist even when no conservative pick qualifies', async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))
    expect(html).not.toContain('PLACE watchlist')
    expect(html).not.toContain('place-watchlist-title')
    expect(html).toContain('Tomorrow&#x27;s conservative picks')
    expect(html).toContain('No forecasts meet the current conservative eligibility filters.')
    expect(html).toContain('1 of 1 races have predictions.')
  })

  it('distinguishes pending predictions from rejected forecasts', async () => {
    vi.mocked(getUpcomingRaces).mockResolvedValue([{ ...fixture(), prediction: null }])
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Predictions pending for all 1 races.')
    expect(html).not.toContain('No forecasts meet')
  })

  it('reports missing reliability data without the removed watchlist', async () => {
    vi.mocked(loadReliabilityContext).mockResolvedValue(null)
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Reliability data unavailable.')
    expect(html).not.toContain('PLACE watchlist')
  })

  it('hides non-TAB races from the race list and coverage counts', async () => {
    vi.mocked(getUpcomingRaces).mockResolvedValue([fixture(), { ...fixture(), id: 'non-tab', race_name: 'Non-TAB Race' }])
    const snapshot = await loadHomeSnapshot({} as SupabaseClient)
    expect(snapshot.races.map(race => race.id)).toEqual(['race'])
    expect(snapshot.tabRaceIds).toEqual(['race'])
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('/races/race')
    expect(html).not.toContain('/races/non-tab')
    expect(html).not.toContain('Non-TAB Race')
    expect(html).toContain('1 of 1 races have predictions.')
  })

  it('preserves the probability controls when toggling other filters', async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ sort: 'top3Probability', minPct: '60' }) }))
    expect(html).toContain('minReliability=80&amp;sort=top3Probability&amp;minPct=60')
  })
})