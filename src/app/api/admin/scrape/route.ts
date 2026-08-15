import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'

export async function POST() {
  if (!await hasAdminSession()) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(
    { success: false, message: 'Upcoming race ingestion is not configured' },
    { status: 501 },
  )
}
