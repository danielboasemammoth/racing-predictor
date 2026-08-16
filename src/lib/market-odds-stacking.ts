import type { PredictionPayload, PredictedHorse } from '@/lib/types'

export interface MarketStackInput {
  predictions: PredictionPayload
  oddsByHorse: Record<string, { win?: number; place?: number }>
}

export function applyMarketStacking({ predictions, oddsByHorse }: MarketStackInput): PredictionPayload {
  if (!Object.keys(oddsByHorse).length) return predictions

  const horses = predictions.all_horses.slice()
  const winOdds = horses.map((horse: PredictedHorse) => ({
    horseId: horse.horse_id,
    odds: oddsByHorse[horse.horse_id]?.win ?? null,
    impliedProbability: oddsByHorse[horse.horse_id]?.win ? 1 / oddsByHorse[horse.horse_id].win! : null,
  }))

  const top = winOdds.filter((entry) => entry.odds && entry.impliedProbability && entry.impliedProbability > 0)
  if (!top.length) return predictions

  const minImplied = Math.max(...top.map((entry) => entry.impliedProbability!))
  const maxImplied = Math.min(...top.map((entry) => entry.impliedProbability!))
  const range = minImplied - maxImplied

  const updated = horses.map((horse: PredictedHorse) => {
    const market = winOdds.find((entry) => entry.horseId === horse.horse_id)
    if (!market || !market.impliedProbability || !range) return horse

    const normalized = (market.impliedProbability - maxImplied) / range
    const blend = 0.25
    const adjustedProbability = horse.win_probability! * (1 - blend) + normalized * blend
    const adjustedTop3 = horse.top3_probability! * (1 - blend) + Math.min(normalized * 2.5, 1) * blend

    return {
      ...horse,
      win_probability: adjustedProbability,
      top3_probability: adjustedTop3,
      confidence: adjustedProbability,
    }
  })

  const podium = updated.slice().sort((left, right) => (right.win_probability ?? 0) - (left.win_probability ?? 0)).slice(0, 3)

  return {
    ...predictions,
    podium,
    all_horses: updated.sort((left, right) => (right.win_probability ?? 0) - (left.win_probability ?? 0)),
  }
}
