import { NextResponse } from 'next/server'
import { hasAdminSession } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { deletePendingAutoBets } from '@/lib/paper-betting/repository'

const ACCOUNT_NAME = 'default'

/**
 * Clears not-yet-settled auto-placed bets and re-triggers a PuntersEdge sync so they're
 * recreated with up-to-date stakes - meant to be called right after the user changes the
 * starting budget or staking method, since neither retroactively resizes already-placed bets.
 * Forwards the caller's session cookie to /api/admin/puntersedge/sync rather than duplicating
 * its logic here.
 */
export async function POST(request: Request) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const account = await admin.from('paper_accounts').select('id').eq('name', ACCOUNT_NAME).maybeSingle()
  if (account.error) return NextResponse.json({ success: false, message: account.error.message }, { status: 500 })
  if (!account.data) return NextResponse.json({ success: false, message: 'No paper betting account set up yet' }, { status: 400 })

  try {
    const deletedCount = await deletePendingAutoBets(admin, account.data.id as string)

    const syncResponse = await fetch(new URL('/api/admin/puntersedge/sync', request.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: request.headers.get('cookie') ?? '' },
      body: '{}',
    })
    const syncPayload = (await syncResponse.json().catch(() => null)) as { success?: boolean; message?: string } | null
    if (!syncResponse.ok || !syncPayload?.success) {
      return NextResponse.json({
        success: false,
        deletedCount,
        message: `Cleared ${deletedCount} pending bet${deletedCount === 1 ? '' : 's'}, but the regeneration sync failed: ${syncPayload?.message ?? 'unknown error'}`,
      }, { status: 502 })
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Cleared ${deletedCount} pending bet${deletedCount === 1 ? '' : 's'} and regenerated: ${syncPayload.message}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to regenerate recent paper bets'
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
