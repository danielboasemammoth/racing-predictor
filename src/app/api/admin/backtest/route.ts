import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const supabase = await createClient()
    // TODO: Implement backtesting — compare predictions vs actual results for completed races
    return NextResponse.json({ success: true, message: 'Backtest queued — implement in backtest module' })
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
