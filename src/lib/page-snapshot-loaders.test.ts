import { expect, it } from 'vitest'
import { compactPrediction, currentSnapshotRaces, currentSnapshotOpportunities } from './page-snapshot-loaders'
import type { Prediction, PredictedHorse, RaceWithPrediction } from './types'
import type { OpportunityRow } from './paper-betting/opportunities-query'

it('expires started races and limits old homepage snapshots to today and tomorrow in Melbourne', () => {
  const now = new Date('2026-09-21T14:05:00Z')
  const races = [
    { id: 'past', status: 'upcoming', race_datetime: '2026-09-21T14:04:00Z' },
    { id: 'today', status: 'upcoming', race_datetime: '2026-09-22T01:00:00Z' },
    { id: 'tomorrow', status: 'upcoming', race_datetime: '2026-09-23T01:00:00Z' },
    { id: 'later', status: 'upcoming', race_datetime: '2026-09-24T01:00:00Z' },
    { id: 'completed', status: 'completed', race_datetime: '2026-09-22T01:00:00Z' },
  ] as RaceWithPrediction[]
  expect(currentSnapshotRaces(races, now, races.map(race => race.id)).map(race => race.id)).toEqual(['today', 'tomorrow'])
})

it('excludes non-TAB races and unverified legacy snapshots from the home page', () => {
  const now = new Date('2026-09-26T00:00:00Z')
  const races = [
    { id: 'tab', status: 'upcoming', race_datetime: '2026-09-26T05:00:00Z' },
    { id: 'non-tab', status: 'upcoming', race_datetime: '2026-09-26T05:00:00Z' },
  ] as RaceWithPrediction[]
  expect(currentSnapshotRaces(races, now, ['tab']).map(race => race.id)).toEqual(['tab'])
  expect(currentSnapshotRaces(races, now)).toEqual([])
  expect(currentSnapshotRaces(races, now, [])).toEqual([])
})

it('expires cached quotes after 30 minutes or race start and rejects future timestamps', () => {
  const now = new Date('2026-09-21T00:00:00Z')
  const makeRow = (id: string, generated: string, start = '2026-09-21T00:10:00Z') => ({
    id, generated_at: generated, pe_races: { start_time: start },
  }) as OpportunityRow
  const rows = [
    makeRow('fresh', '2026-09-20T23:45:00Z'),
    makeRow('expired', '2026-09-20T23:29:59Z'),
    makeRow('future', '2026-09-21T00:00:01Z'),
    makeRow('started', '2026-09-20T23:45:00Z', now.toISOString()),
  ]
  expect(currentSnapshotOpportunities(rows, now).map(row => row.id)).toEqual(['fresh'])
})

const horse = (id: string, name: string): PredictedHorse => ({
  horse_id: id, horse_name: name, predicted_position: 1, confidence: 0.6, win_probability: 0.6, top3_probability: 0.9,
  win_odds: 3, value_rating: 'strong',
})
const compactHorse = ({ horse_id, horse_name, predicted_position, confidence, win_probability, top3_probability }: PredictedHorse) => ({
  horse_id, horse_name, predicted_position, confidence, win_probability, top3_probability,
})

const prediction: Prediction = {
  id: 'prediction', race_id: 'race', model_version: 'model-v1', predicted_at: '2026-11-14T00:00:00Z',
  confidence_scores: { overall: 0.7, winner: 0.6, podium: 0.9 }, predicted_times: { horse1: 90 }, accuracy_score: 1,
  predictions: {
    podium: [horse('horse1', 'Runner One'), horse('horse2', 'Runner Two'), horse('horse3', 'Runner Three')],
    all_horses: [horse('horse1', 'Runner One'), horse('horse2', 'Runner Two'), horse('horse3', 'Runner Three')],
    trifecta: { horse_ids: ['horse1', 'horse2', 'horse3'], horse_names: ['Runner One', 'Runner Two', 'Runner Three'], probability: 0.1, fair_return_10: 100, likelihood: 'medium', notable_value: true },
    value_opportunities: Array.from({ length: 5 }, (_, index) => ({ horse_id: `horse${index}`, horse_name: `Runner ${index}`, market: 'win' as const, probability: 0.5, odds: 3, return_10: 30, value_edge: 0.1 })),
    place_hedges: Array.from({ length: 4 }, () => ({ horses: [{ horse_id: 'horse1', horse_name: 'Runner One', place_odds: 2, place_probability: 0.5, stake_share: 0.5 }], combined_edge: 0.1, prob_at_least_one_places: 0.8, guaranteed_profit_per_10: 1 })),
    feature_snapshots: {
      horse1: { features: { historyStarts: 7, unused: 'x'.repeat(1000) } },
      horse2: { features: { historyStarts: 4, unused: 'x'.repeat(1000) } },
    },
    model_components: [{ model_version: 'base', winner_horse_id: 'horse1', winner_horse_name: 'Runner One', winner_confidence: 0.6, podium_horse_ids: ['horse1'] }],
    model_agreement: { winner_votes: 2, model_count: 3, unanimous: false },
  },
}

it('retains the homepage display data while compacting primary predictions', () => {
  const compact = compactPrediction(prediction, true)

  expect(compact.predictions.podium).toEqual(prediction.predictions.podium)
  expect(compact.predictions.all_horses).toEqual(prediction.predictions.all_horses.map(compactHorse))
  expect(compact.predictions.trifecta).toEqual(prediction.predictions.trifecta)
  expect(compact.predictions.value_opportunities).toHaveLength(3)
  expect(compact.predictions.place_hedges).toHaveLength(2)
  expect(compact.predictions.feature_snapshots).toEqual({ horse1: { features: { historyStarts: 7 } } })
  expect(compact.predictions.model_components).toBeUndefined()
})

it('keeps only the winner fields needed to compare secondary models', () => {
  const compact = compactPrediction(prediction, false)

  expect(compact.predictions).toEqual({ podium: [compactHorse(prediction.predictions.podium[0])], all_horses: [] })
  expect(compact.confidence_scores).toEqual({ overall: 0.7, winner: 0.6 })
})