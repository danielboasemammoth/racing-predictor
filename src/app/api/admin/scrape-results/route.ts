import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = await createClient()
    // TODO: Implement actual result scraping from Breednet / Racing.com
    return NextResponse.json({ success: true, message: 'Result scraper stub — implement in scraper module' })
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
