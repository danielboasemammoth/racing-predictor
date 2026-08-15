import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ingestRacingCom } from '@/lib/scrapers/racing-com'

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
    const summary = await ingestRacingCom(createAdminClient(), melbourneDate())
    return NextResponse.json({
      success: true,
      ...summary,
      message: `Imported ${summary.races} races and ${summary.entries} entries from Racing.com`,
    })
  } catch (error) {
    console.error('Racing.com ingestion failed', error)
    return NextResponse.json({ success: false, message: 'Racing.com ingestion failed' }, { status: 502 })
  }
}
