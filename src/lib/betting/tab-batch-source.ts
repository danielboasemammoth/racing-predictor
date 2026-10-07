import type { SupabaseClient } from '@supabase/supabase-js'
import { getUpcomingRaces } from '../upcoming-races'
import { melbourneDateKey } from '../daily-picks'
import { findMatchingInternalRace, normalizeHorseName } from '../paper-betting/fundamentals-bridge'
import type { HomePicksArchive, RecordedHomePick } from '../home-picks-archive'
import type { Prediction } from '../types'
import { buildSimulationRace, type SimulationSource } from './simulation-source'
import type { SimulationDecision } from './simulation-decision'
import type { SimulationEvidence } from './simulation-evidence'
import type { SimulationPreferences } from './simulation-preferences'
import { buildTabBatchPreview, type TabBatchRace, type TabJurisdiction } from './tab-batch'
import type { TabPrice } from '../paper-betting/internal-tab-odds'

interface TabMeeting {
  meetingName: string
  meetingDate: string
  raceType: string
  venueMnemonic: string
  sellCode?: { meetingCode: string; scheduledType: string }
  races: Array<{ raceNumber: number; raceStartTime: string; raceStatus: string; hasParimutuel: boolean }>
}
interface TabRaceDetail {
  meeting: Omit<TabMeeting, 'races'>
  raceNumber: number
  raceStartTime: string
  raceStatus: string
  pools: Array<{ wageringProduct: string; poolStatusCode: string }>
  runners: Array<{ runnerNumber: number; runnerName: string; parimutuel?: { bettingStatus: string }; fixedOdds?: { bettingStatus: string; returnWin?: number; returnPlace?: number } }>
}

export function mapTabBatchRace(id: string, detail: TabRaceDetail, date: string): TabBatchRace {
  const meeting = detail.meeting
  if (meeting?.meetingDate !== date || meeting.raceType !== 'R' || meeting.sellCode?.scheduledType !== 'R'
    || detail.raceStatus !== 'Normal' || !Array.isArray(detail.runners) || !Array.isArray(detail.pools)) throw new Error('TAB race identity or status is unavailable')
  if (new Set(detail.runners.map(runner => runner.runnerNumber)).size !== detail.runners.length) throw new Error('Duplicate TAB runner numbers')
  return { id, code: `${meeting.sellCode.meetingCode}R`, venue: meeting.meetingName, number: detail.raceNumber, start: detail.raceStartTime,
    winOpen: detail.pools.some(pool => pool.wageringProduct === 'Win' && pool.poolStatusCode === 'Open'),
    placeOpen: detail.pools.some(pool => pool.wageringProduct === 'Place' && pool.poolStatusCode === 'Open'),
    runners: detail.runners.map(runner => ({ name: runner.runnerName, number: runner.runnerNumber, open: runner.parimutuel?.bettingStatus === 'Open' && !/scratch/i.test(runner.fixedOdds?.bettingStatus ?? '') })) }
}

export async function loadTabBatchPreview(db: SupabaseClient, preferences: SimulationPreferences, jurisdiction: TabJurisdiction, fetcher: typeof fetch = fetch) {
  const now = new Date()
  const date = melbourneDateKey(now)
  const upcoming = await getUpcomingRaces(db)
  if (upcoming.length >= 300) throw new Error('Upcoming race limit reached; refusing a partial batch')
  const races = upcoming.filter(race => melbourneDateKey(race.race_datetime) === date && Date.parse(race.race_datetime) > now.getTime())
  if (!races.length) return buildTabBatchPreview([], [], preferences, jurisdiction, now)
  const request = async <Value>(path: string): Promise<Value> => {
    const response = await fetcher(`https://api.beta.tab.com.au/v1/tab-info-service/racing/dates/${date}/${path}?jurisdiction=${jurisdiction}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!response.ok || Number(response.headers.get('age') ?? 0) > 30) throw new Error('Current TAB race data is unavailable; no batch generated')
    return await response.json() as Value
  }
  const schedule = await request<{ meetings: TabMeeting[] }>('meetings')
  if (!Array.isArray(schedule.meetings)) throw new Error('Invalid TAB schedule')
  const scheduled = schedule.meetings.filter(meeting => meeting.raceType === 'R' && meeting.meetingDate === date).flatMap(meeting => meeting.races
    .filter(race => race.hasParimutuel && race.raceStatus === 'Normal' && Date.parse(race.raceStartTime) > now.getTime())
    .map(race => ({ raceId: `${meeting.venueMnemonic}:${race.raceNumber}`, racecourseName: meeting.meetingName, raceNumber: race.raceNumber, raceDatetime: race.raceStartTime, meeting })))
  const retained = new Map<string, RecordedHomePick>()
  if (Object.values(preferences.filters).some(filter => filter.enabled && filter.forecast !== 'latest' && filter.forecast !== undefined)) {
    const archives = await db.from('analysis_snapshots').select('id, payload, generated_at').like('kind', 'home-picks-v1:%')
      .gte('generated_at', new Date(now.getTime() - 3 * 86_400_000).toISOString()).order('generated_at').order('id').limit(200)
    if (archives.error) throw archives.error
    if ((archives.data?.length ?? 0) >= 200) throw new Error('History archive limit reached; cannot verify the first selection')
    for (const row of archives.data ?? []) {
      const archive = row.payload as HomePicksArchive
      if (archive.schema !== 1 || !Array.isArray(archive.picks)) continue
      for (const pick of archive.picks) {
        const key = `${pick.race.id}:${pick.horse.horse_id}`
        if (races.some(race => race.id === pick.race.id) && !retained.has(key)) retained.set(key, pick)
      }
    }
  }
  const original = new Map<string, Prediction & { created_at: string }>()
  const ids = [...new Set([...retained.values()].map(pick => pick.predictionId))]
  for (let offset = 0; offset < ids.length; offset += 20) {
    const result = await db.from('predictions').select('*').in('id', ids.slice(offset, offset + 20))
    if (result.error) throw result.error
    for (const prediction of result.data ?? []) original.set(prediction.id, prediction)
  }
  const evidence = new Map<string, SimulationEvidence | SimulationDecision>()
  const keys = races.flatMap(race => (race.model_predictions ?? []).flatMap(prediction => [`simulator-evidence-v1:${prediction.id}`, `simulator-decision-v1:${race.id}:${prediction.model_version}`]))
  for (let offset = 0; offset < keys.length; offset += 100) {
    const result = await db.from('analysis_snapshots').select('kind, payload').in('kind', keys.slice(offset, offset + 100))
    if (result.error) throw result.error
    for (const row of result.data ?? []) evidence.set(row.kind, row.payload)
  }
  const forecast = (prediction: Prediction): SimulationSource['forecasts'][number] => ({ id: prediction.id, model: prediction.model_version,
    predictedAt: prediction.predicted_at, createdAt: (prediction as Prediction & { created_at?: string }).created_at ?? '',
    podium: prediction.predictions.podium, allHorses: prediction.predictions.all_horses, field: prediction.predictions.all_horses.map(horse => horse.horse_id),
    evidence: evidence.get(`simulator-evidence-v1:${prediction.id}`) as SimulationEvidence | undefined })
  const sources: ReturnType<typeof buildSimulationRace>[] = []
  const tabRaces: TabBatchRace[] = []
  const warnings: string[] = []
  for (let offset = 0; offset < races.length; offset += 3) {
    await Promise.all(races.slice(offset, offset + 3).map(async race => {
      const match = findMatchingInternalRace(race.racecourses?.name ?? '', race.race_number, race.race_datetime, scheduled, 5)
      if (!match) { warnings.push(`${race.racecourses?.name} R${race.race_number}: no unique upcoming TAB Tote meeting match`); return }
      const scheduleRace = scheduled.find(item => item.raceId === match.raceId)!
      const detail = await request<TabRaceDetail>(`meetings/R/${encodeURIComponent(scheduleRace.meeting.venueMnemonic)}/races/${race.race_number}`)
      const capturedAt = new Date().toISOString()
      const mapped = mapTabBatchRace(race.id, detail, date)
      if (mapped.number !== race.race_number || detail.meeting.venueMnemonic !== scheduleRace.meeting.venueMnemonic
        || Math.abs(Date.parse(mapped.start) - Date.parse(race.race_datetime)) > 5 * 60_000) throw new Error('TAB race identity changed during generation')
      const current = await db.from('race_entries').select('horse_id, status').eq('race_id', race.id).limit(100)
      if (current.error) throw current.error
      if ((current.data?.length ?? 0) >= 100) throw new Error('Runner limit reached')
      const predictions = race.model_predictions?.length ? race.model_predictions : race.prediction ? [race.prediction] : []
      const source: SimulationSource = { id: race.id, start: race.race_datetime, settledAt: null, venue: race.racecourses?.name ?? '', state: race.racecourses?.state ?? '', number: race.race_number,
        entries: (current.data ?? []).map(entry => ({ ...entry, position: null })), forecasts: predictions.map(forecast),
        decisions: predictions.flatMap(prediction => { const decision = evidence.get(`simulator-decision-v1:${race.id}:${prediction.model_version}`); return decision ? [decision as SimulationDecision] : [] }),
        history: [...retained.values()].filter(pick => pick.race.id === race.id).flatMap(pick => { const prediction = original.get(pick.predictionId); return prediction?.race_id === race.id ? [{ forecast: forecast(prediction), horseId: pick.horse.horse_id,
          winProbability: pick.winProbability, top3Probability: pick.top3Probability, observedAt: pick.observedAt, provenance: pick.provenance, tabPrice: pick.tabPrice, tabPriceStatus: pick.tabPriceStatus }] : [] }) }
      const prices = new Map<string, TabPrice>()
      for (const runner of detail.runners) {
        const name = normalizeHorseName(runner.runnerName)
        if (detail.runners.filter(other => normalizeHorseName(other.runnerName) === name).length !== 1 || runner.fixedOdds?.bettingStatus !== 'Open') continue
        prices.set(name, { win: runner.fixedOdds.returnWin, place: runner.fixedOdds.returnPlace, quotedAt: capturedAt, capturedAt })
      }
      const built = buildSimulationRace(source, prices)
      const openRunners = mapped.runners.filter(runner => runner.open)
      for (const selection of [...built.selections, ...(built.decisionSelections ?? []), ...(built.historySelections ?? [])]) {
        const prediction = selection.forecastBasis === 'history' ? original.get(selection.predictionId ?? '') : predictions.find(prediction => prediction.model_version === selection.model)
        const frozen = selection.winSource === 'tab_decision' ? source.decisions?.find(decision => decision.forecast.model === selection.model)?.forecast.allHorses : undefined
        const names = (frozen ?? prediction?.predictions.all_horses ?? []).map(horse => normalizeHorseName(horse.horse_name))
        selection.fullField = selection.fullField && names.length === openRunners.length && new Set(names).size === names.length && openRunners.every(runner => names.includes(normalizeHorseName(runner.name)))
      }
      built.fieldSize = openRunners.length
      sources.push(built)
      tabRaces.push(mapped)
    }))
  }
  const preview = buildTabBatchPreview(sources, tabRaces, preferences, jurisdiction, new Date())
  preview.expiresAt = new Date(Math.min(Date.parse(preview.expiresAt), now.getTime() + 120_000)).toISOString()
  if (Date.parse(preview.expiresAt) <= Date.now()) throw new Error('Source checks took too long; generate a fresh batch')
  const retainedCount = [...retained.values()].filter(pick => Date.parse(pick.race.race_datetime) > Date.now()).length
  if (Object.values(preferences.filters).some(filter => filter.enabled && ['history', 'picks-history'].includes(filter.forecast ?? ''))) {
    preview.warnings.push(`${retainedCount} archived upcoming selections found; ${sources.reduce((total, race) => total + (race.historySelections?.length ?? 0), 0)} have original forecasts and a matched TAB race. Missing selections are not reconstructed.`)
  }
  preview.warnings.push(...warnings)
  return preview
}