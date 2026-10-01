import { readSimulationPreferences } from '@/lib/betting/simulation-preferences'
import { buildRunnerConfig, DEFAULT_RISK_LIMITS, type RealBettingRunnerConfig, type RealBettingStrategy } from './config'

export const strategy: RealBettingStrategy = { schema: 1, name: 'Place value', savedAt: '2026-10-01T00:00:00.000Z', preferences: readSimulationPreferences(null) }
export const configId = '11111111-2222-4333-8444-555555555555'

export function runnerConfig(overrides: Partial<RealBettingRunnerConfig> = {}): RealBettingRunnerConfig {
  return { ...JSON.parse(JSON.stringify(buildRunnerConfig(strategy, DEFAULT_RISK_LIMITS, configId, new Date('2026-10-01T01:00:00Z')))), ...overrides }
}
