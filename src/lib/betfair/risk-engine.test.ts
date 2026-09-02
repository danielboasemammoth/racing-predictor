import { describe, it, expect } from 'vitest'
import { evaluateBetCandidate, capStakeToLiquidity, type BetCandidate, type RiskSettings, type AccountState, type SystemHealth } from './risk-engine'

const settings: RiskSettings = {
  minConfidence: 0.5,
  minEdgePct: 5,
  minExpectedValue: 0,
  minOdds: 1.5,
  maxOdds: 20,
  minLiquidity: 50,
  maxLiquidityConsumptionPct: 0.2,
  maxBet: 2,
  maxPctBankroll: 0.01,
  maxTotalExposurePct: 0.05,
  maxDailyStake: 20,
  maxDailyLossPct: 0.05,
  maxBetsPerDay: 10,
  maxBetsPerRace: 1,
  minMinutesToJump: 2,
  maxMinutesToJump: 60,
  permittedCodes: ['horse', 'greyhound'],
  permittedStates: ['VIC', 'NSW'],
  horseEnabled: true,
  greyhoundEnabled: true,
  nswThoroughbredAutoEnabled: false,
}

const goodCandidate: BetCandidate = {
  racingCode: 'horse',
  state: 'VIC',
  marketStatus: 'OPEN',
  priceAgeSeconds: 2,
  decimalOdds: 4.0,
  modelProbability: 0.35,
  confidence: 0.8,
  edgePct: 15,
  commissionAdjustedExpectedValue: 1.5,
  liquidityAvailable: 200,
  minutesToJump: 10,
}

const goodAccount: AccountState = {
  bankrollAvailable: 100,
  dailyStakeSoFar: 0,
  dailyRealizedLoss: 0,
  totalOpenExposure: 0,
  betsPlacedTodayForThisRace: 0,
  betsPlacedToday: 0,
  startingDailyBankroll: 100,
}

const healthyHealth: SystemHealth = {
  betfairConnected: true,
  liveDataAvailable: true,
  databaseHealthy: true,
  riskEngineHealthy: true,
  duplicateCheckPassed: true,
}

describe('evaluateBetCandidate - happy path', () => {
  it('approves a qualifying candidate', () => {
    const result = evaluateBetCandidate(goodCandidate, settings, goodAccount, healthyHealth)
    expect(result.decision).toBe('BET')
    expect(result.reasons).toEqual([])
  })
})

describe('evaluateBetCandidate - fail-closed on system health', () => {
  it('rejects when any health flag is false', () => {
    const flags: (keyof SystemHealth)[] = ['betfairConnected', 'liveDataAvailable', 'databaseHealthy', 'riskEngineHealthy', 'duplicateCheckPassed']
    for (const flag of flags) {
      const health = { ...healthyHealth, [flag]: false }
      const result = evaluateBetCandidate(goodCandidate, settings, goodAccount, health)
      expect(result.decision).toBe('NO_BET')
    }
  })
})

describe('evaluateBetCandidate - bankroll', () => {
  it('rejects null or zero bankroll', () => {
    expect(evaluateBetCandidate(goodCandidate, settings, { ...goodAccount, bankrollAvailable: null }, healthyHealth).decision).toBe('NO_BET')
    expect(evaluateBetCandidate(goodCandidate, settings, { ...goodAccount, bankrollAvailable: 0 }, healthyHealth).decision).toBe('NO_BET')
  })
})

describe('evaluateBetCandidate - market status / staleness / timing', () => {
  it('rejects a non-OPEN market', () => {
    expect(evaluateBetCandidate({ ...goodCandidate, marketStatus: 'IN_PLAY' }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
    expect(evaluateBetCandidate({ ...goodCandidate, marketStatus: 'SUSPENDED' }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
  })

  it('rejects a stale price', () => {
    expect(evaluateBetCandidate({ ...goodCandidate, priceAgeSeconds: 30 }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
  })

  it('rejects outside the minutes-to-jump window', () => {
    expect(evaluateBetCandidate({ ...goodCandidate, minutesToJump: 1 }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
    expect(evaluateBetCandidate({ ...goodCandidate, minutesToJump: 120 }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
  })
})

describe('evaluateBetCandidate - code/state permissions', () => {
  it('rejects a disabled racing code', () => {
    expect(evaluateBetCandidate(goodCandidate, { ...settings, horseEnabled: false }, goodAccount, healthyHealth).decision).toBe('NO_BET')
  })

  it('rejects a state not in the permitted list', () => {
    expect(evaluateBetCandidate({ ...goodCandidate, state: 'QLD' }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
  })

  it('blocks NSW thoroughbred automation by default even if NSW is otherwise permitted', () => {
    const nswSettings = { ...settings, permittedStates: ['VIC', 'NSW'] }
    const result = evaluateBetCandidate({ ...goodCandidate, state: 'NSW' }, nswSettings, goodAccount, healthyHealth)
    expect(result.decision).toBe('NO_BET')
    expect(result.reasons[0]).toMatch(/NSW/)
  })

  it('allows NSW thoroughbred automation when explicitly enabled', () => {
    const nswSettings = { ...settings, permittedStates: ['VIC', 'NSW'], nswThoroughbredAutoEnabled: true }
    const result = evaluateBetCandidate({ ...goodCandidate, state: 'NSW' }, nswSettings, goodAccount, healthyHealth)
    expect(result.decision).toBe('BET')
  })
})

describe('evaluateBetCandidate - value thresholds', () => {
  it('rejects low confidence, low edge, non-positive EV, out-of-range odds, and thin liquidity', () => {
    expect(evaluateBetCandidate({ ...goodCandidate, confidence: 0.3 }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
    expect(evaluateBetCandidate({ ...goodCandidate, edgePct: 1 }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
    expect(evaluateBetCandidate({ ...goodCandidate, commissionAdjustedExpectedValue: -0.5 }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
    expect(evaluateBetCandidate({ ...goodCandidate, decimalOdds: 1.1 }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
    expect(evaluateBetCandidate({ ...goodCandidate, liquidityAvailable: 10 }, settings, goodAccount, healthyHealth).decision).toBe('NO_BET')
  })
})

describe('evaluateBetCandidate - exposure and daily limits', () => {
  it('rejects when max bets per race/day reached', () => {
    expect(evaluateBetCandidate(goodCandidate, settings, { ...goodAccount, betsPlacedTodayForThisRace: 1 }, healthyHealth).decision).toBe('NO_BET')
    expect(evaluateBetCandidate(goodCandidate, settings, { ...goodAccount, betsPlacedToday: 10 }, healthyHealth).decision).toBe('NO_BET')
  })

  it('rejects when daily stake limit reached', () => {
    expect(evaluateBetCandidate(goodCandidate, settings, { ...goodAccount, dailyStakeSoFar: 20 }, healthyHealth).decision).toBe('NO_BET')
  })

  it('rejects when the daily loss stop has triggered', () => {
    const result = evaluateBetCandidate(goodCandidate, settings, { ...goodAccount, dailyRealizedLoss: 5, startingDailyBankroll: 100 }, healthyHealth)
    expect(result.decision).toBe('NO_BET')
    expect(result.reasons[0]).toMatch(/Daily loss stop/)
  })

  it('rejects when total open exposure exceeds the configured percentage of bankroll', () => {
    const result = evaluateBetCandidate(goodCandidate, settings, { ...goodAccount, totalOpenExposure: 5 }, healthyHealth)
    expect(result.decision).toBe('NO_BET')
  })
})

describe('capStakeToLiquidity', () => {
  it('never exceeds the configured percentage of available liquidity', () => {
    expect(capStakeToLiquidity(100, 200, 0.2)).toBe(40)
    expect(capStakeToLiquidity(10, 200, 0.2)).toBe(10)
  })
})
