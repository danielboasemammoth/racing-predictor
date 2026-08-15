import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

interface HorseWithEntry {
  id: string
  name: string
  career_runs?: number
  career_wins?: number
  best_time_this_distance?: number
  wet_form_rating?: number
  heavy_form_rating?: number
  dry_form_rating?: number
  last_race_date?: string
  last_race_result?: string
}

async function predictRace(raceId: string, entries: any[], horses: HorseWithEntry[]) {
  const predictions: any = {
    podium: [],
    all_horses: [],
  }

  const scored = entries.map(entry => {
    const horse = horses.find(h => h.id === entry.horse_id)
    if (!horse) return { ...entry, score: 0, confidence: 0.1 }

    let score = 0
    let confidence = 0.3

    if (horse.career_runs && horse.career_runs > 0) {
      const winRate = horse.career_wins! / horse.career_runs
      score += winRate * 3
      confidence += Math.min(winRate, 0.3)
    }

    if (horse.best_time_this_distance) {
      score += 0.5
      confidence += 0.1
    }

    if (horse.wet_form_rating) {
      score += horse.wet_form_rating * 0.5
      confidence += 0.1
    }

    if (horse.last_race_date) {
      const daysSince = (Date.now() - new Date(horse.last_race_date).getTime()) / 86400000
      if (daysSince < 30) {
        score += 0.2
        confidence += 0.05
      }
    }

    if (entry.barrier_number && entry.barrier_number <= 4) {
      score += 0.15
    }

    return {
      ...entry,
      horse_name: horse.name,
      score,
      confidence: Math.min(confidence, 0.95),
      predicted_time: horse.best_time_this_distance || null,
    }
  })

  scored.sort((a: any, b: any) => b.score - a.score)

  const podium = scored.slice(0, 3).map((s: any, idx: number) => ({
    horse_id: s.horse_id,
    horse_name: s.horse_name,
    predicted_position: idx + 1,
    predicted_time: s.predicted_time,
    confidence: s.confidence,
  }))

  const allHorses = scored.map((s: any, idx: number) => ({
    horse_id: s.horse_id,
    horse_name: s.horse_name,
    predicted_position: idx + 1,
    predicted_time: s.predicted_time,
    confidence: s.confidence,
  }))

  predictions.podium = podium
  predictions.all_horses = allHorses

  const overallConfidence = podium.reduce((sum: number, p: any) => sum + (p.confidence || 0), 0) / Math.max(podium.length, 1)

  return {
    predictions,
    confidence_scores: {
      overall: overallConfidence,
      winner: podium[0]?.confidence || 0,
      podium: overallConfidence,
    },
    predicted_times: Object.fromEntries(scored.map((s: any) => [s.horse_id, s.predicted_time || 0])),
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { raceId?: string }
    const { raceId } = body

    let racesToPredict: any[] = []

    if (raceId) {
      const { data } = await supabase.from('races').select('id').eq('id', raceId).eq('status', 'upcoming').single()
      if (data) racesToPredict = [data]
    } else {
      const { data } = await supabase.from('races').select('id').eq('status', 'upcoming').limit(20)
      racesToPredict = data || []
    }

    if (racesToPredict.length === 0) {
      return NextResponse.json({ success: false, message: 'No upcoming races to predict' })
    }

    let created = 0

    for (const race of racesToPredict) {
      const { data: entries } = await supabase
        .from('race_entries')
        .select('*, horses(*)')
        .eq('race_id', race.id)

      if (!entries || entries.length === 0) continue

      const horses: HorseWithEntry[] = entries.map(e => e.horses).filter(Boolean) as HorseWithEntry[]
      const result = await predictRace(race.id, entries, horses)

      await supabase.from('predictions').insert({
        race_id: race.id,
        model_version: 'v1-heuristic',
        predictions: result.predictions,
        confidence_scores: result.confidence_scores,
        predicted_times: result.predicted_times,
      })

      created++
    }

    return NextResponse.json({ success: true, created, message: `Generated predictions for ${created} races` })
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
