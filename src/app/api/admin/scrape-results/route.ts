import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { ingestRacingCom } from '@/lib/scrapers/racing-com'
import { createAdminClient } from '@/lib/supabase/admin'

function melbourneDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function POST() {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await ingestRacingCom(createAdminClient(), melbourneDate(), {
      daysBack: 7,
      daysForward: 0,
    })
    return NextResponse.json({
      success: true,
      ...summary,
      message: `Refreshed ${summary.races} historical races and ${summary.entries} results`,
    })
  } catch (error) {
    console.error('Racing.com result ingestion failed', error)
    return NextResponse.json({ success: false, message: 'Racing.com result ingestion failed' }, { status: 502 })
  }
}
