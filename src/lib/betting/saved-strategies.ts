import { readSimulationPreferences, type SimulationPreferences } from './simulation-preferences'

export const SAVED_STRATEGIES_KEY = 'racing-saved-strategies-v1'
export async function loadSavedStrategies(): Promise<{ strategies: SavedStrategy[]; canEdit: boolean }> {
  const response = await fetch('/api/betting-strategies', { cache: 'no-store' })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'Could not load saved strategies.')
  return { strategies: Array.isArray(body.strategies) ? body.strategies.flatMap((entry: unknown) => readSavedStrategies(JSON.stringify([entry]))) : [], canEdit: body.canEdit === true }
}

export interface SavedStrategy {
  schema: 1
  name: string
  savedAt: string
  preferences: SimulationPreferences
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

export function readSavedStrategies(raw: string | null): SavedStrategy[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 50).flatMap(value => {
      if (!value || typeof value !== 'object' || value.schema !== 1
        || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120
        || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))) return []
      const preferences = readSimulationPreferences(JSON.stringify(value.preferences))
      if (canonical(preferences) !== canonical(value.preferences)) return []
      return [{ schema: 1 as const, name: value.name.trim(), savedAt: value.savedAt, preferences }]
    })
  } catch { return [] }
}

export function saveStrategy(existing: SavedStrategy[], name: string, preferences: SimulationPreferences, now = new Date()): SavedStrategy[] {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 120) throw new Error('Enter a strategy name of 1-120 characters.')
  const strategy: SavedStrategy = { schema: 1, name: trimmed, savedAt: now.toISOString(), preferences: structuredClone(preferences) }
  if (!readSavedStrategies(JSON.stringify([strategy])).length) throw new Error('Strategy contains unsupported settings.')
  return [strategy, ...existing.filter(entry => entry.name !== trimmed)].slice(0, 50)
}