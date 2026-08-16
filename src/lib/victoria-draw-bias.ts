export interface DrawBiasProfile {
  insideGood: boolean
  outsideGood: boolean
  biasStrength: number
  sampleSize: number
  lastUpdated: string
}

const victoriaCourses: Record<string, DrawBiasProfile> = {
  'Flemington': { insideGood: true, outsideGood: false, biasStrength: 0.7, sampleSize: 1200, lastUpdated: '2026-08-15' },
  'Caulfield': { insideGood: true, outsideGood: false, biasStrength: 0.65, sampleSize: 900, lastUpdated: '2026-08-15' },
  'Moonee Valley': { insideGood: false, outsideGood: true, biasStrength: 0.55, sampleSize: 800, lastUpdated: '2026-08-15' },
  'Sandown': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 600, lastUpdated: '2026-08-15' },
  'Warrnambool': { insideGood: true, outsideGood: false, biasStrength: 0.6, sampleSize: 300, lastUpdated: '2026-08-15' },
  'Ballarat': { insideGood: true, outsideGood: false, biasStrength: 0.55, sampleSize: 400, lastUpdated: '2026-08-15' },
  'Bendigo': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 350, lastUpdated: '2026-08-15' },
  'Geelong': { insideGood: true, outsideGood: false, biasStrength: 0.45, sampleSize: 500, lastUpdated: '2026-08-15' },
  'Mornington': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 280, lastUpdated: '2026-08-15' },
  'Sale': { insideGood: true, outsideGood: false, biasStrength: 0.55, sampleSize: 260, lastUpdated: '2026-08-15' },
  'Cranbourne': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 220, lastUpdated: '2026-08-15' },
  'Pakenham': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 240, lastUpdated: '2026-08-15' },
  'Melton': { insideGood: false, outsideGood: true, biasStrength: 0.45, sampleSize: 320, lastUpdated: '2026-08-15' },
  'Healesville': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 180, lastUpdated: '2026-08-15' },
  'Traralgon': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 200, lastUpdated: '2026-08-15' },
  'Moe': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 190, lastUpdated: '2026-08-15' },
  'Wodonga': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 170, lastUpdated: '2026-08-15' },
  'Shepparton': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 210, lastUpdated: '2026-08-15' },
  'Mildura': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 160, lastUpdated: '2026-08-15' },
  'Wangaratta': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 150, lastUpdated: '2026-08-15' },
  'Ararat': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 140, lastUpdated: '2026-08-15' },
  'Echuca': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 130, lastUpdated: '2026-08-15' },
  'Swan Hill': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 120, lastUpdated: '2026-08-15' },
  'Horsham': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 120, lastUpdated: '2026-08-15' },
  'Casterton': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 110, lastUpdated: '2026-08-15' },
  'Portland': { insideGood: true, outsideGood: false, biasStrength: 0.5, sampleSize: 100, lastUpdated: '2026-08-15' },
  'Warrnambool (Jan)': { insideGood: true, outsideGood: false, biasStrength: 0.6, sampleSize: 80, lastUpdated: '2026-08-15' },
}

export function lookupDrawBias(racecourseId: string): DrawBiasProfile | undefined {
  return victoriaCourses[racecourseId]
}

export function drawBiasScore(racecourseId: string, barrierNumber?: number | null): number {
  const profile = lookupDrawBias(racecourseId)
  if (!profile || barrierNumber == null) return 0
  if (profile.insideGood && barrierNumber <= 4) return profile.biasStrength * 0.1
  if (profile.outsideGood && barrierNumber >= 8) return profile.biasStrength * 0.1
  return 0
}
