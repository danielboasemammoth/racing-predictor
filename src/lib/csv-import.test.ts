import { describe, expect, it } from 'vitest'
import {
  inferColumns,
  isValidHorseName,
  missingRequiredColumns,
  normaliseRacecourse,
  optionalNumber,
  parseCsv,
} from '@/lib/csv-import'

describe('CSV import parsing', () => {
  it('parses escaped quotes and multiline quoted fields', () => {
    expect(parseCsv('horse_name,notes\n"O""Brien", "line one\nline two"')).toEqual([
      ['horse_name', 'notes'],
      ['O"Brien', 'line one\nline two'],
    ])
  })

  it('rejects unclosed quoted fields', () => {
    expect(() => parseCsv('horse_name,notes\nAlpha,"unclosed')).toThrow('unclosed quoted field')
  })

  it('reports missing required columns', () => {
    const indexes = inferColumns(['date', 'horse_name'])
    expect(missingRequiredColumns(indexes)).toEqual(['racecourse'])
  })

  it('accepts Victorian courses and rejects unrelated venues', () => {
    expect(normaliseRacecourse('Sportsbet Sandown Lakeside')).toBe('Sandown')
    expect(normaliseRacecourse('Randwick')).toBeNull()
  })

  it('validates horse names and parses decorated numbers', () => {
    expect(isValidHorseName("O'Brien (NZ)")).toBe(true)
    expect(isValidHorseName('')).toBe(false)
    expect(isValidHorseName('x'.repeat(201))).toBe(false)
    expect(optionalNumber(['59.5kg'], 0)).toBe(59.5)
  })
})
