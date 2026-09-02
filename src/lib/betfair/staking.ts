/**
 * Betfair staking. Reuses the existing kellyFraction() math from src/lib/betting/kelly.ts (single
 * source of truth for the Kelly formula) but exposes a wider range of methods than the
 * PuntersEdge system needs (flat-dollar, arbitrary Kelly fraction, and a documented "conservative"
 * blend), per the Betfair product spec. Full Kelly (fraction 1.0) is never permitted here -
 * MAX_KELLY_FRACTION caps it.
 */
import { kellyFraction } from '@/lib/betting/kelly'

export type BetfairStakingMethod = 'flat' | 'pct-bankroll' | 'kelly-0.10' | 'kelly-0.25' | 'kelly-0.50' | 'conservative'

export interface StakingLimits {
  maxBet: number
  maxPctBankroll: number
}

export interface StakingInput {
  method: BetfairStakingMethod
  bankroll: number
  decimalOdds: number
  modelProbability: number
  flatStakeAmount: number
  pctBankrollStake: number
  limits: StakingLimits
  /** Only used by 'conservative' - see computeConservativeStake for the exact formula. */
  confidence?: number
  modelUncertainty?: number
  liquidityAvailable?: number
}

const MAX_KELLY_FRACTION = 0.5
const KELLY_MULTIPLIERS: Record<'kelly-0.10' | 'kelly-0.25' | 'kelly-0.50', number> = {
  'kelly-0.10': 0.1,
  'kelly-0.25': 0.25,
  'kelly-0.50': MAX_KELLY_FRACTION,
}

function applyLimits(rawStake: number, bankroll: number, limits: StakingLimits): number {
  const capped = Math.min(rawStake, bankroll * limits.maxPctBankroll, limits.maxBet)
  return capped > 0 ? Math.round(capped * 100) / 100 : 0
}

/**
 * CONSERVATIVE MODE FORMULA (documented per product spec - not an unexplained algorithm):
 *   base = bankroll * kellyFraction(odds, p) * 0.25         (quarter-Kelly base)
 *   confidenceAdjusted = base * confidence                   (confidence in 0-1, discounts low-confidence picks)
 *   uncertaintyAdjusted = confidenceAdjusted * (1 - modelUncertainty)  (modelUncertainty in 0-1)
 *   liquidityCapped = min(uncertaintyAdjusted, liquidityAvailable * 0.20)  (never take >20% of visible liquidity)
 * Then the normal maxBet/maxPctBankroll limits are applied on top, same as every other method.
 */
export function computeConservativeStake(
  bankroll: number,
  decimalOdds: number,
  modelProbability: number,
  confidence: number,
  modelUncertainty: number,
  liquidityAvailable: number,
): number {
  const kelly = kellyFraction(decimalOdds, modelProbability)
  if (kelly <= 0) return 0
  const base = bankroll * kelly * 0.25
  const confidenceAdjusted = base * confidence
  const uncertaintyAdjusted = confidenceAdjusted * (1 - modelUncertainty)
  return Math.min(uncertaintyAdjusted, liquidityAvailable * 0.2)
}

/** Recommended stake in dollars. Returns 0 whenever the method yields no edge - callers must treat 0 as NO BET. */
export function computeStake(input: StakingInput): number {
  if (input.bankroll <= 0) return 0

  if (input.method === 'flat') {
    return applyLimits(input.flatStakeAmount, input.bankroll, input.limits)
  }
  if (input.method === 'pct-bankroll') {
    return applyLimits(input.bankroll * input.pctBankrollStake, input.bankroll, input.limits)
  }
  if (input.method === 'conservative') {
    const raw = computeConservativeStake(
      input.bankroll,
      input.decimalOdds,
      input.modelProbability,
      input.confidence ?? 1,
      input.modelUncertainty ?? 0,
      input.liquidityAvailable ?? Infinity,
    )
    return raw > 0 ? applyLimits(raw, input.bankroll, input.limits) : 0
  }

  const fraction = kellyFraction(input.decimalOdds, input.modelProbability)
  if (fraction <= 0) return 0
  const multiplier = Math.min(KELLY_MULTIPLIERS[input.method], MAX_KELLY_FRACTION)
  return applyLimits(input.bankroll * fraction * multiplier, input.bankroll, input.limits)
}
