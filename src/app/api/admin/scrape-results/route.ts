import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    // TODO: Implement actual result scraping from Breednet / Racing.com
    // For now, return success
    return NextResponse.json({ success: true, message: 'Scrape queued — implement in scraper module' })
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
