import { hasAdminSession } from '@/lib/admin-auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { readSavedStrategies, saveStrategy } from '@/lib/betting/saved-strategies'
import type { SimulationPreferences } from '@/lib/betting/simulation-preferences'

export const dynamic = 'force-dynamic'

function unavailable() {
  return Response.json({ message: 'Saved strategies unavailable. Check the database and apply migrate-betting-strategies.sql.' }, { status: 503 })
}

export async function GET() {
  try {
    const db = await createClient()
    const { data, error } = await db.from('betting_strategies').select('name, preferences, saved_at').order('name').limit(1000)
    if (error) return unavailable()
    const strategies = (data ?? []).flatMap(row => readSavedStrategies(JSON.stringify([{ schema: 1, name: row.name, preferences: row.preferences, savedAt: row.saved_at }])))
    return Response.json({ strategies, canEdit: await hasAdminSession() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return unavailable() }
}

export async function POST(request: Request) {
  if (!await hasAdminSession()) return Response.json({ message: 'Admin login required to save strategies.' }, { status: 401 })
  let strategy
  try {
    const body = await request.json()
    if (typeof body?.name !== 'string') throw new Error('Enter a strategy name.')
    strategy = saveStrategy([], body.name, body.preferences as SimulationPreferences)[0]
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : 'Invalid strategy.' }, { status: 400 })
  }
  try {
    const { error } = await createAdminClient().from('betting_strategies').upsert({ name: strategy.name, preferences: strategy.preferences, saved_at: strategy.savedAt }, { onConflict: 'name' })
    if (error) return unavailable()
    return Response.json({ strategy })
  } catch { return unavailable() }
}

export async function DELETE(request: Request) {
  if (!await hasAdminSession()) return Response.json({ message: 'Admin login required to delete strategies.' }, { status: 401 })
  let name: string
  try {
    const body = await request.json()
    if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) throw new Error('Invalid strategy name.')
    name = body.name.trim()
  } catch { return Response.json({ message: 'Invalid strategy name.' }, { status: 400 }) }
  try {
    const { error } = await createAdminClient().from('betting_strategies').delete().eq('name', name)
    if (error) return unavailable()
    return Response.json({ success: true })
  } catch { return unavailable() }
}