export function legacyPaperBettingEnabled(): boolean {
  return process.env.LEGACY_PAPER_BETTING_ENABLED === 'true'
}

export const LEGACY_BETTING_RETIRED_MESSAGE = 'Live paper betting is paused. Existing records and settlement are preserved.'