import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshSingleRace } from '@/lib/scrapers/racing-com'
import { POST as predictPOST } from '@/app/api/admin/predict/route'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body: unknown = await request.json()
    const raceId = typeof body === 'object' && body !== null && 'raceId' in body ? (body as { raceId: unknown }).raceId : undefined
    if (typeof raceId !== 'string' || !UUID_PATTERN.test(raceId)) {
      return NextResponse.json({ success: false, message: 'Invalid raceId' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const refreshResult = await refreshSingleRace(supabase, raceId)
    if (!refreshResult.found) {
      return NextResponse.json({ success: false, message: 'Race not found in the current Racing.com feed' }, { status: 404 })
    }

    // Reuses the existing predict route in-process (same request's admin session already
    // applies) instead of duplicating its model-running/write logic for a single race.
    const predictResponse = await predictPOST(new Request('http://internal/api/admin/predict', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ raceId, mode: 'all' }),
    }))
    const predictPayload = await predictResponse.json() as { success: boolean; message?: string }
    if (!predictPayload.success) {
      return NextResponse.json({ success: false, message: `Refreshed race data but prediction rerun failed: ${predictPayload.message}` }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      status: refreshResult.status,
      horses: refreshResult.horses,
      entries: refreshResult.entries,
      updatedAt: new Date().toISOString(),
      message: `Refreshed ${refreshResult.entries} runners and regenerated predictions`,
    })
  } catch (error) {
    console.error('Race refresh failed', error)
    return NextResponse.json({ success: false, message: 'Race refresh failed' }, { status: 500 })
  }
}
