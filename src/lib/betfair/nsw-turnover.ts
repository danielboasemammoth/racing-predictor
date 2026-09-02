/**
 * Racing NSW turnover-charge tracking. Per Betfair's published rules (verify against current
 * official docs before relying on this for real money - rules/thresholds can change): the charge
 * can apply for a weekly period where aggregate matched BACK turnover on relevant Racing NSW
 * markets is >= AUD $1,000 AND commission generated is less than 1.25% of that turnover. When
 * applicable, the charge is currently 3% of aggregate matched back turnover.
 *
 * This module only classifies risk/proximity to the threshold - it does NOT submit any charge to
 * Betfair (that's calculated and applied by Betfair itself). Used purely to warn/block automated
 * NSW thoroughbred betting before exposure becomes likely.
 */

export const NSW_TURNOVER_THRESHOLD = 1000
export const NSW_COMMISSION_RATIO_THRESHOLD = 0.0125
export const NSW_TURNOVER_CHARGE_RATE = 0.03

export type NswThresholdState = 'ok' | 'warning' | 'strong_warning' | 'blocked'

export interface NswTurnoverStatus {
  turnover: number
  commissionPaid: number
  commissionToTurnoverRatio: number | null
  turnoverThresholdPct: number
  state: NswThresholdState
  potentiallyApplicable: boolean
}

/**
 * Classifies this week's NSW turnover status. Warning bands are based on proximity to the $1,000
 * turnover threshold (75%/90%/100%), matching the product spec - blocking at 100% turnover is a
 * precautionary default (turnover is known in advance of settlement; the commission-ratio
 * condition can only be confirmed after settlement, so we don't wait for it before blocking).
 * "potentiallyApplicable" is a separate informational flag for whether the FORMAL two-condition
 * charge rule (turnover >= $1,000 AND ratio < 1.25%) is actually met.
 */
export function classifyNswTurnoverStatus(turnover: number, commissionPaid: number): NswTurnoverStatus {
  const turnoverThresholdPct = turnover / NSW_TURNOVER_THRESHOLD
  const commissionToTurnoverRatio = turnover > 0 ? commissionPaid / turnover : null

  const meetsTurnover = turnover >= NSW_TURNOVER_THRESHOLD
  const meetsRatio = commissionToTurnoverRatio != null && commissionToTurnoverRatio < NSW_COMMISSION_RATIO_THRESHOLD
  const potentiallyApplicable = meetsTurnover && meetsRatio

  let state: NswThresholdState = 'ok'
  if (turnoverThresholdPct >= 1.0) {
    state = 'blocked'
  } else if (turnoverThresholdPct >= 0.9) {
    state = 'strong_warning'
  } else if (turnoverThresholdPct >= 0.75) {
    state = 'warning'
  }

  return { turnover, commissionPaid, commissionToTurnoverRatio, turnoverThresholdPct, state, potentiallyApplicable }
}

/** Estimated charge if the current week's status is (or becomes) applicable - informational only. */
export function estimatedNswTurnoverCharge(turnover: number): number {
  return turnover * NSW_TURNOVER_CHARGE_RATE
}

/** True when default risk settings should block new automated NSW thoroughbred bets this week. */
export function shouldBlockAutomatedNswBetting(status: NswTurnoverStatus, autoEnabledOverride: boolean): boolean {
  if (autoEnabledOverride) return false
  return status.state === 'blocked' || status.state === 'strong_warning'
}
