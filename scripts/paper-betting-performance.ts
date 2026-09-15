import { createScriptClient } from './supabase-client'
import { marketPerformance, type ValidationBet } from '../src/lib/paper-betting/validation-query'

async function main() {
  const admin = createScriptClient()
  const account = await admin.from('paper_accounts').select('id, name, current_bankroll, staking_method').eq('name', 'default').single()
  if (account.error) throw account.error
  const bets: ValidationBet[] = []
  for (let offset = 0; ; offset += 1000) {
    const result = await admin.from('paper_bets')
      .select('stake, tab_decimal_odds, edge_points, model_probability, status, profit, placed_at, bet_type, race_id, source, mode, model_version')
      .eq('account_id', account.data.id).in('status', ['WON', 'LOST'])
      .order('placed_at').order('id').range(offset, offset + 999)
    if (result.error) throw result.error
    const page = (result.data ?? []) as ValidationBet[]
    bets.push(...page)
    if (page.length < 1000) break
  }
  const groups = new Map<string, ValidationBet[]>()
  for (const bet of bets) {
    const key = `${bet.source} / ${bet.mode} / ${bet.model_version}`
    const group = groups.get(key) ?? []
    group.push(bet)
    groups.set(key, group)
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    account: { name: account.data.name, bankroll: account.data.current_bankroll, staking: account.data.staking_method },
    firstBet: bets[0]?.placed_at ?? null,
    lastBet: bets.at(-1)?.placed_at ?? null,
    markets: marketPerformance(bets),
    groups: [...groups].map(([label, rows]) => ({ label, markets: marketPerformance(rows).filter((market) => market.n > 0) })),
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})