import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PAGE_CACHE_KEYS, refreshPageCache, type PageCacheKey } from '@/lib/refresh-page-cache'

export const maxDuration = 300

export async function POST(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ success: false, message: 'Invalid JSON' }, { status: 400 }) }
  const key = body && typeof body === 'object' && 'key' in body ? body.key : undefined
  if (typeof key !== 'string' || !PAGE_CACHE_KEYS.includes(key as PageCacheKey)) {
    return NextResponse.json({ success: false, message: 'A valid snapshot key is required' }, { status: 400 })
  }
  const results = await refreshPageCache(createAdminClient(), [key as PageCacheKey])
  const success = results.every(result => result.ok)
  if (success) revalidateTag('page-snapshots', 'max')
  return NextResponse.json({ success, message: success ? `Published ${key} snapshot` : `Kept previous ${key} snapshot; refresh failed`, results }, { status: success ? 200 : 503 })
}