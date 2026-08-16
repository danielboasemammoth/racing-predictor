export interface CsvColumnIndexes {
  racecourse: number
  race_datetime: number
  race_number: number
  distance_m: number
  track_condition: number
  race_class: number
  horse_name: number
  finishing_position: number
  finishing_time: number
  margin: number
  barrier_number: number
  weight_carried: number
  jockey: number
  trainer: number
  status: number
}

const VICTORIA_COURSES = [
  'Flemington',
  'Caulfield',
  'Moonee Valley',
  'Sandown',
  'Ballarat',
  'Bendigo',
  'Geelong',
  'Mornington',
  'Sale',
  'Cranbourne',
  'Pakenham',
  'Melton',
  'Healesville',
  'Traralgon',
  'Moe',
  'Wodonga',
  'Shepparton',
  'Mildura',
  'Wangaratta',
  'Ararat',
  'Echuca',
  'Swan Hill',
  'Horsham',
  'Casterton',
  'Portland',
]

export function normaliseRacecourse(name: string) {
  const value = name.trim().toLowerCase()
  return VICTORIA_COURSES.find((course) => value.includes(course.toLowerCase())) ?? null
}

export function isValidHorseName(name: string) {
  const value = name.trim()
  return value.length >= 2 && value.length <= 200 && /^[\p{L}\p{N} .&'()\-/]+$/u.test(value)
}

export function parseCsv(text: string): string[][] {
  if (!text.trim()) return []

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (character === ',' && !inQuotes) {
      row.push(field.trim())
      field = ''
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field.trim())
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (inQuotes) throw new Error('CSV contains an unclosed quoted field')
  row.push(field.trim())
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

function column(headers: string[], primary: string, fallback?: string) {
  const primaryIndex = headers.indexOf(primary)
  return primaryIndex !== -1 ? primaryIndex : fallback ? headers.indexOf(fallback) : -1
}

export function inferColumns(headers: string[]): CsvColumnIndexes {
  const lower = headers.map((header) => header.trim().toLowerCase())
  return {
    racecourse: column(lower, 'racecourse'),
    race_datetime: column(lower, 'race_datetime', 'date'),
    race_number: column(lower, 'race_number'),
    distance_m: column(lower, 'distance_m', 'distance'),
    track_condition: column(lower, 'track_condition', 'condition'),
    race_class: column(lower, 'race_class', 'class'),
    horse_name: column(lower, 'horse_name', 'horse'),
    finishing_position: column(lower, 'finishing_position', 'position'),
    finishing_time: column(lower, 'finishing_time', 'time'),
    margin: column(lower, 'margin'),
    barrier_number: column(lower, 'barrier_number', 'barrier'),
    weight_carried: column(lower, 'weight_carried', 'weight'),
    jockey: column(lower, 'jockey'),
    trainer: column(lower, 'trainer'),
    status: column(lower, 'status'),
  }
}

export function missingRequiredColumns(indexes: CsvColumnIndexes) {
  const required: Array<keyof CsvColumnIndexes> = ['racecourse', 'race_datetime', 'horse_name']
  return required.filter((columnName) => indexes[columnName] === -1)
}

export function optionalValue(row: string[], index: number) {
  return index >= 0 ? row[index]?.trim() || undefined : undefined
}

export function optionalNumber(row: string[], index: number) {
  const value = optionalValue(row, index)
  if (value === undefined) return undefined
  const number = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(number) ? number : undefined
}
