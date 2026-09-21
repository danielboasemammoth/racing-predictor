import { expect, it } from 'vitest'
import { currentSnapshotRaces, currentSnapshotOpportunities } from './page-snapshot-loaders'
import type { RaceWithPrediction } from './types'
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
  expect(currentSnapshotRaces(races, now).map(race => race.id)).toEqual(['today', 'tomorrow'])
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