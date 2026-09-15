import { createScriptClient } from './supabase-client'
import { loadValidationBets, marketPerformance, policyPerformance, type ValidationBet } from '../src/lib/paper-betting/validation-query'
import { supportsPolicyTracking } from '../src/lib/paper-betting/policy-tracking'

async function main() {
  const admin = createScriptClient()
  const account = await admin.from('paper_accounts').select('id, name, current_bankroll, staking_method').eq('name', 'default').single()
  if (account.error) throw account.error
  const bets = await loadValidationBets(admin, account.data.id)
  const groups = new Map<string, ValidationBet[]>()
  for (const bet of bets) {
    const key = `${bet.source} / ${bet.mode} / ${bet.model_version}`
    const group = groups.get(key) ?? []
    group.push(bet)
    groups.set(key, group)
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    policyTrackingAvailable: await supportsPolicyTracking(admin),
    policies: policyPerformance(bets),
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