import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadDailyPicksHistory } from './daily-picks-history'
import { PRODUCTION_MODEL_VERSION } from './prediction-suite'

afterEach(() => vi.useRealTimers())

const race = { id: 'race', race_datetime: '2026-10-03T07:45:00Z', race_number: 1, racecourses: { name: 'Toowoomba' } }
const horse = { horse_id: 'horse', horse_name: 'Thundering Soul', win_probability: 0.502894527743605, top3_probability: 0.639806418127594 }
const forecast = { id: 'forecast', race_id: 'race', model_version: PRODUCTION_MODEL_VERSION,
  predicted_at: '2026-10-02T20:06:52Z', created_at: '2026-10-02T20:07:56Z', podium: [horse] }

function database(forecasts = [forecast], archives: unknown[] = [], status = 'finished') {
  vi.useFakeTimers().setSystemTime(new Date('2026-10-05T00:00:00Z'))
  const cursors = vi.fn()
  const db = { from: (table: string) => {
    let after: string | null = null
    let limit = 0
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gte: vi.fn().mockReturnThis(), like: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      gt: (column: string, value: string) => { after = value; cursors(table, column, value); return query },
      limit: (value: number) => { limit = value; return query },
      then: (resolve: (value: unknown) => unknown) => {
        const rows = (table === 'races' ? [race] : table === 'predictions' ? forecasts : table === 'analysis_snapshots' ? archives
          : [{ id: 'entry', race_id: 'race', horse_id: 'horse', finishing_position: 1, status }]) as Array<{ id: string }>
        return Promise.resolve({ data: rows.filter(row => !after || row.id > after).slice(0, limit), error: null }).then(resolve)
      },
    }
    return query
  } } as unknown as SupabaseClient
  return { db, cursors }
}

it('recovers the original qualifying pre-race horse without requiring a retrospective forecast or inventing reliability', async () => {
  const { db } = database([
    { ...forecast, id: 'post-created', created_at: '2026-10-03T08:00:00Z' },
    { ...forecast, id: 'retrospective', model_version: `${PRODUCTION_MODEL_VERSION}-retrospective` },
    forecast,
    { ...forecast, id: 'later', created_at: '2026-10-03T02:00:00Z', podium: [{ ...horse, win_probability: 0.8 }] },
  ])
  const history = await loadDailyPicksHistory(db)
  expect(history[0].picks).toHaveLength(1)
  expect(history[0].picks[0]).toMatchObject({ predictionId: 'forecast', winProbability: horse.win_probability,
    top3Probability: horse.top3_probability, reliability: null, won: true, provenance: 'pre-race-recovery' })
})

it('keeps frozen homepage scores instead of reranking against later predictions and retains scratched picks', async () => {
  const pick = { race, horse, winProbability: 0.5, top3Probability: 0.64, reliability: { score: 83 },
    predictionId: 'original', provenance: 'home-snapshot', observedAt: '2026-10-03T00:00:00Z',
    tabPrice: { win: 2, place: 1.2, capturedAt: '2026-10-02T23:59:30Z', quotedAt: '2026-10-02T23:59:20Z' }, tabPriceStatus: 'captured' }
  const archive = { id: 'archive', generated_at: pick.observedAt, payload: { schema: 1, dateKeys: ['2026-10-03'], picks: [pick] } }
  const later = { ...archive, id: 'later', generated_at: '2026-10-03T02:00:00Z', payload: { ...archive.payload, picks: [{ ...pick, winProbability: 0.9, tabPrice: { ...pick.tabPrice, win: 9 } }] } }
  const { db } = database([forecast], [archive, later], 'scratched')
  const history = await loadDailyPicksHistory(db)
  expect(history[0].picks).toHaveLength(1)
  expect(history[0].picks[0]).toMatchObject({ winProbability: 0.5, top3Probability: 0.64, reliability: { score: 83 }, scratched: true, won: false, placedTop3: false, tabPrice: pick.tabPrice, tabPriceStatus: 'captured' })
})

it('does not fill an archived empty shortlist with reconstructed picks', async () => {
  const { db } = database([forecast], [{ id: 'archive', generated_at: '2026-10-03T00:00:00Z', payload: { schema: 1, dateKeys: ['2026-10-03'], picks: [] } }])
  expect(await loadDailyPicksHistory(db)).toEqual([])
})

it('paginates forecasts and rejects post-start timestamps', async () => {
  const { db, cursors } = database(Array.from({ length: 251 }, (_, index) => ({ ...forecast, id: String(index).padStart(4, '0'),
    predicted_at: index === 250 ? forecast.predicted_at : '2026-10-03T08:00:00Z' })))
  const history = await loadDailyPicksHistory(db)
  expect(cursors).toHaveBeenCalledWith('predictions', 'id', '0249')
  expect(history[0].picks[0].predictionId).toBe('0250')
})

it('still recovers races completed before archiving began partway through the day', async () => {
  const { db } = database([forecast], [{ id: 'archive', generated_at: '2026-10-03T08:00:00Z', payload: { schema: 1, dateKeys: ['2026-10-03'], picks: [] } }])
  expect((await loadDailyPicksHistory(db))[0].picks[0].predictionId).toBe('forecast')
})