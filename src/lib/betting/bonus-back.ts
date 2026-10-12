import type { SupabaseClient } from '@supabase/supabase-js'

export interface BonusBackOffer {
  raceId: string
  runnerId: string
  runnerName: string
  confirmedAt: string
  startsAt: string
  cap: number
  basis: 'manual'
}

export interface PaperBonusClaim {
  betId: string
  offer: BonusBackOffer
  placedAt: string
  stake: number
}

export const BONUS_OFFER_PREFIX = 'tab-bonus-back-v1:'
export const BONUS_CLAIM_PREFIX = 'paper-bonus-back-v1:'

export function isBonusBackOffer(value: unknown): value is BonusBackOffer {
  if (!value || typeof value !== 'object') return false
  const offer = value as BonusBackOffer
  return offer.basis === 'manual' && typeof offer.raceId === 'string' && typeof offer.runnerId === 'string'
    && typeof offer.runnerName === 'string' && Number.isFinite(offer.cap) && offer.cap > 0 && offer.cap <= 50
    && Number.isFinite(Date.parse(offer.confirmedAt)) && Date.parse(offer.confirmedAt) < Date.parse(offer.startsAt)
}

export function bonusBackEligible(offer: BonusBackOffer | undefined, raceId: string, runnerId: string, market: string, placedAt: string | undefined): boolean {
  const placed = Date.parse(placedAt ?? '')
  return !!offer && isBonusBackOffer(offer) && market === 'WIN' && offer.raceId === raceId && offer.runnerId === runnerId
    && placed >= Date.parse(offer.confirmedAt) && placed < Date.parse(offer.startsAt)
}

export function bonusBackCredit(stake: number, cap: number, status: string, finish: number | null | undefined): number {
  if (status !== 'LOST' || ![2, 3].includes(finish ?? 0) || !Number.isFinite(stake) || stake <= 0 || !Number.isFinite(cap) || cap <= 0 || cap > 50) return 0
  return Math.floor(Math.min(stake, cap) * 100 + 1e-9) / 100
}

export function bonusBackProbability(win: number | undefined, topThree: number | undefined): number | null {
  if (win == null || topThree == null || !Number.isFinite(win) || !Number.isFinite(topThree) || win < 0 || topThree > 1 || topThree < win) return null
  return topThree - win
}

export async function readBonusBackOffers(db: SupabaseClient): Promise<BonusBackOffer[]> {
  const rows: BonusBackOffer[] = []
  let after = BONUS_OFFER_PREFIX
  for (;;) {
    const result = await db.from('analysis_snapshots').select('kind, payload').like('kind', `${BONUS_OFFER_PREFIX}%`)
      .gt('kind', after).order('kind').limit(500).retry(false)
    if (result.error) throw result.error
    const page = result.data ?? []
    for (const row of page) if (isBonusBackOffer(row.payload)) rows.push(row.payload)
    if (page.length < 500) return rows
    after = page[page.length - 1].kind
  }
}

export async function recordPaperBonusClaim(db: SupabaseClient, input: { accountId: string; betId: string; raceId: string; runnerId: string; market: string; source: string; oddsSource?: string; stake: number; placedAt: string }) {
  if (input.source !== 'internal' || input.market !== 'WIN' || input.oddsSource !== 'tab') return
  const row = await db.from('analysis_snapshots').select('payload').eq('kind', `${BONUS_OFFER_PREFIX}${input.raceId}`).maybeSingle()
  if (row.error) throw row.error
  const offer = row.data?.payload
  if (!isBonusBackOffer(offer) || !bonusBackEligible(offer, input.raceId, input.runnerId, input.market, input.placedAt)) return
  const claim: PaperBonusClaim = { betId: input.betId, offer, placedAt: input.placedAt, stake: input.stake }
  const result = await db.from('analysis_snapshots').upsert({
    kind: `${BONUS_CLAIM_PREFIX}${input.accountId}:${input.raceId}`,
    payload: claim,
    generated_at: input.placedAt,
  }, { onConflict: 'kind', ignoreDuplicates: true })
  if (result.error) throw result.error
}

export async function readPaperBonusCredits(db: SupabaseClient, accountId: string) {
  const claims: PaperBonusClaim[] = []
  let after = `${BONUS_CLAIM_PREFIX}${accountId}:`
  for (;;) {
    const result = await db.from('analysis_snapshots').select('kind, payload').like('kind', `${BONUS_CLAIM_PREFIX}${accountId}:%`)
      .gt('kind', after).order('kind').limit(500).retry(false)
    if (result.error) throw result.error
    const page = result.data ?? []
    for (const row of page) {
      const claim = row.payload as PaperBonusClaim
      if (claim && typeof claim.betId === 'string' && isBonusBackOffer(claim.offer) && bonusBackEligible(claim.offer, claim.offer.raceId, claim.offer.runnerId, 'WIN', claim.placedAt)) claims.push(claim)
    }
    if (page.length < 500) break
    after = page[page.length - 1].kind
  }
  const credits: Array<{ betId: string; runnerName: string; status: string; credit: number; cap: number }> = []
  for (let offset = 0; offset < claims.length; offset += 20) {
    const batch = claims.slice(offset, offset + 20)
    const [bets, entries] = await Promise.all([
      db.from('paper_bets').select('id, status, stake').eq('account_id', accountId).in('id', batch.map(claim => claim.betId)).retry(false),
      db.from('race_entries').select('race_id, horse_id, finishing_position').in('race_id', batch.map(claim => claim.offer.raceId)).in('horse_id', batch.map(claim => claim.offer.runnerId)).retry(false),
    ])
    if (bets.error) throw bets.error
    if (entries.error) throw entries.error
    for (const claim of batch) {
      const bet = bets.data?.find(bet => bet.id === claim.betId)
      if (!bet) continue
      const entry = entries.data?.find(entry => entry.race_id === claim.offer.raceId && entry.horse_id === claim.offer.runnerId)
      credits.push({ betId: bet.id, runnerName: claim.offer.runnerName, status: bet.status, cap: claim.offer.cap,
        credit: bonusBackCredit(Number(bet.stake), claim.offer.cap, bet.status, entry?.finishing_position) })
    }
  }
  return credits
}