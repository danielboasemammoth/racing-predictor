import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BONUS_OFFER_PREFIX, readBonusBackOffers, type BonusBackOffer } from '@/lib/betting/bonus-back'
import { getTabScheduledRaces } from '@/lib/tab-races'
import type { RaceWithPrediction } from '@/lib/types'

export async function GET() {
  try {
    const db = await createClient({ signal: AbortSignal.timeout(5000) })
    return NextResponse.json({ offers: await readBonusBackOffers(db), canEdit: await hasAdminSession() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ message: 'Promotion confirmations unavailable.' }, { status: 503 })
  }
}

export async function POST(request: Request) {
  if (!(await hasAdminSession())) return NextResponse.json({ message: 'Admin login required.' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
  if (!body || typeof body.raceId !== 'string' || !uuid.test(body.raceId) || typeof body.runnerId !== 'string' || !uuid.test(body.runnerId)
    || body.confirmed !== true || typeof body.cap !== 'number' || !Number.isFinite(body.cap) || body.cap <= 0 || body.cap > 50 || Math.abs(body.cap * 100 - Math.round(body.cap * 100)) > 0.000001) {
    return NextResponse.json({ message: 'Confirm eligibility, select a race and runner, and enter a cap between $0.01 and $50.' }, { status: 400 })
  }
  try {
    const db = createAdminClient()
    const race = await db.from('races').select('*, racecourses(*)').eq('id', body.raceId).eq('status', 'upcoming').maybeSingle()
    if (race.error) throw race.error
    const scheduled = race.data ? await getTabScheduledRaces([race.data as RaceWithPrediction]) : []
    const startsAt = scheduled[0]?.race_datetime
    if (!startsAt || Date.parse(startsAt) <= Date.now()) return NextResponse.json({ message: 'The race is not open on the current TAB schedule.' }, { status: 409 })
    const entry = await db.from('race_entries').select('horse_id, status, horses(name)').eq('race_id', body.raceId).eq('horse_id', body.runnerId).maybeSingle()
    if (entry.error) throw entry.error
    const horse = Array.isArray(entry.data?.horses) ? entry.data.horses[0] : entry.data?.horses
    if (!entry.data || entry.data.status === 'scratched' || !horse?.name) return NextResponse.json({ message: 'Runner is unavailable or scratched.' }, { status: 409 })
    const confirmedAt = new Date().toISOString()
    if (Date.parse(startsAt) <= Date.parse(confirmedAt)) return NextResponse.json({ message: 'The race has started.' }, { status: 409 })
    const offer: BonusBackOffer = { raceId: body.raceId, runnerId: body.runnerId, runnerName: horse.name, cap: body.cap, confirmedAt, startsAt, basis: 'manual' }
    const result = await db.from('analysis_snapshots').upsert({ kind: `${BONUS_OFFER_PREFIX}${body.raceId}`, payload: offer, generated_at: confirmedAt }, { onConflict: 'kind', ignoreDuplicates: true }).select('kind')
    if (result.error) throw result.error
    if (!result.data?.length) return NextResponse.json({ message: 'This race already has an immutable promotion confirmation.' }, { status: 409 })
    return NextResponse.json({ offer }, { status: 201 })
  } catch {
    return NextResponse.json({ message: 'Confirmation failed. No promotion should be assumed.' }, { status: 503 })
  }
}