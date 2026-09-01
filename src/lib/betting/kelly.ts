/**
 * Kelly staking. Full Kelly is deliberately never the default anywhere in this codebase - the
 * product spec requires conservative fractional staking (0.10-0.25 Kelly) or flat staking.
 */

export interface StakingCaps {
  /** Max stake as a fraction of current bankroll, e.g. 0.05 for 5%. */
  maxStakePct: number
  /** Minimum stake in dollars - stakes below this are not worth placing. */
  minStake: number
  /** Absolute dollar cap regardless of bankroll size. */
  maxAbsoluteStake: number
}

export const DEFAULT_STAKING_CAPS: StakingCaps = {
  maxStakePct: 0.05,
  minStake: 1,
  maxAbsoluteStake: 100,
}

/**
 * Raw Kelly fraction of bankroll for a decimal-odds bet. Returns 0 (never negative) when the
 * bet has no edge - callers must treat <= 0 as NO BET, never as "bet nothing but still qualifies".
 */
export function kellyFraction(decimalOdds: number, modelProbability: number): number {
  const b = decimalOdds - 1
  if (b <= 0) return 0
  const p = modelProbability
  const q = 1 - p
  const fraction = (b * p - q) / b
  return fraction > 0 ? fraction : 0
}

export type StakingMethod = 'flat-1pct' | 'flat-2pct' | 'kelly-0.10' | 'kelly-0.25'

const KELLY_FRACTION_MULTIPLIERS: Record<'kelly-0.10' | 'kelly-0.25', number> = {
  'kelly-0.10': 0.1,
  'kelly-0.25': 0.25,
}

const FLAT_STAKE_PCT: Record<'flat-1pct' | 'flat-2pct', number> = {
  'flat-1pct': 0.01,
  'flat-2pct': 0.02,
}

function clampStake(rawStake: number, bankroll: number, caps: StakingCaps): number {
  const capped = Math.min(rawStake, bankroll * caps.maxStakePct, caps.maxAbsoluteStake)
  return capped < caps.minStake ? 0 : Math.round(capped * 100) / 100
}

/**
 * Recommended stake for a bet, in dollars. Returns 0 when the method is Kelly-based and the
 * Kelly fraction is <= 0 (no edge) - callers should treat a 0 stake as NO BET.
 */
export function recommendedStake(
  method: StakingMethod,
  bankroll: number,
  decimalOdds: number,
  modelProbability: number,
  caps: StakingCaps = DEFAULT_STAKING_CAPS,
): number {
  if (bankroll <= 0) return 0

  if (method === 'flat-1pct' || method === 'flat-2pct') {
    return clampStake(bankroll * FLAT_STAKE_PCT[method], bankroll, caps)
  }

  const fraction = kellyFraction(decimalOdds, modelProbability)
  if (fraction <= 0) return 0
  const multiplier = KELLY_FRACTION_MULTIPLIERS[method]
  return clampStake(bankroll * fraction * multiplier, bankroll, caps)
}
