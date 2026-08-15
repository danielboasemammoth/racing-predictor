import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    // TODO: Implement actual scraping from Racing.com / Breednet
    // For now, insert demo upcoming races

    const demoRaces = [
      {
        racecourse_id: '00000000-0000-0000-0000-000000000001',
        race_number: 1,
        race_name: 'Maiden Plate',
        distance_m: 1200,
        track_condition: 'good',
        weather_condition: 'fine',
        race_class: 'Maiden',
        prize_money: 35000,
        race_datetime: new Date(Date.now() + 86400000).toISOString(),
        status: 'upcoming',
      },
      {
        racecourse_id: '00000000-0000-0000-0000-000000000001',
        race_number: 2,
        race_name: 'Open Handicap',
        distance_m: 1400,
        track_condition: 'good',
        weather_condition: 'fine',
        race_class: 'Open',
        prize_money: 80000,
        race_datetime: new Date(Date.now() + 86400000 + 3600000).toISOString(),
        status: 'upcoming',
      },
      {
        racecourse_id: '00000000-0000-0000-0000-000000000002',
        race_number: 1,
        race_name: 'Fillies & Mares',
        distance_m: 1600,
        track_condition: 'good',
        weather_condition: 'fine',
        race_class: 'BM78',
        prize_money: 60000,
        race_datetime: new Date(Date.now() + 172800000).toISOString(),
        status: 'upcoming',
      },
    ]

    const { data, error } = await supabase.from('races').upsert(demoRaces, { onConflict: 'external_id' }).select()

    if (error) throw error

    return NextResponse.json({ success: true, count: data?.length || 0, message: 'Demo races inserted' })
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
