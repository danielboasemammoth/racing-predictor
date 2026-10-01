import type { RaceEntryWithHorse } from '../types'
import type { EntryOdds } from '../prediction-v3'

const providerNames: Readonly<Record<string, string>> = {
  SB2: 'Sportsbet',
  LB2: 'Ladbrokes',
  PB3: 'PointsBet',
  BT: 'bet365',
  BTOTE: 'Sportsbet BT+ WIN',
  BTOTESP_LB2: 'Ladbrokes BTSP',
  BTOTESP_PB3: 'PointsBet BT+SP',
  BTOTESP_BT: 'bet365 TOTE WIN',
}

export function racingComProviderLabel(provider?: string | null): string {
  const code = typeof provider === 'string' ? provider.trim() : ''
  if (!code) return 'Provider not recorded'
  return Object.hasOwn(providerNames, code) ? `${providerNames[code]} (${code})` : `Unmapped Racing.com code: ${code}`
}

export function bestRacingComOdds(entry: Pick<RaceEntryWithHorse, 'sectional_times'>): EntryOdds {
  const metadata = entry.sectional_times
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object' || !Array.isArray(metadata.odds)) return {}
  const result: EntryOdds = {}
  for (const quote of metadata.odds) {
    if (!quote || typeof quote !== 'object' || Array.isArray(quote)) continue
    for (const market of ['win', 'place'] as const) {
      const price = Number(quote[market]) || 0
      if (price <= (result[market] ?? 0)) continue
      result[market] = price
      const provider = typeof quote.provider === 'string' ? quote.provider.trim() : ''
      result[market === 'win' ? 'winProvider' : 'placeProvider'] = provider && provider.length <= 120 ? provider : undefined
    }
  }
  return result
}