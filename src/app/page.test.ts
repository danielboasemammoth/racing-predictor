import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './page'
import { getUpcomingRaces } from '@/lib/upcoming-races'
import { loadReliabilityContext } from '@/lib/reliability-context'
import type { RaceWithPrediction } from '@/lib/types'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/upcoming-races', () => ({ getUpcomingRaces: vi.fn() }))
vi.mock('@/lib/reliability-context', () => ({ loadReliabilityContext: vi.fn() }))
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
  vi.mocked(loadReliabilityContext).mockResolvedValue({
    calibration: { overallBaseline: 0.18, probability: [], gap: [], agreement: [], rawRateRange: { min: 0.1, max: 0.3 } }, history: [],
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('homepage pick availability', () => {
  it('shows tomorrow and its PLACE watchlist even when no conservative pick qualifies', async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('PLACE watchlist')
    expect(html).toContain('62.0%')
    expect(html).toContain('Forecast:')
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

  it('reports missing reliability data while retaining the independent watchlist', async () => {
    vi.mocked(loadReliabilityContext).mockResolvedValue(null)
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Reliability data unavailable.')
    expect(html).toContain('62.0%')
  })

  it('preserves the probability controls when toggling other filters', async () => {
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({ sort: 'top3Probability', minPct: '60' }) }))
    expect(html).toContain('minReliability=80&amp;sort=top3Probability&amp;minPct=60')
  })
})