# Live Betting Runbook

## Current state: live betting is impossible, by design

`POST /api/betfair/automation-state` unconditionally rejects any request to set
`liveBettingEnabled: true` with a 400 error, because Stage 1 has no `BetfairExecutionProvider` and
no credentials. This is intentional fail-closed behaviour, not a bug - do not "fix" it by wiring a
shortcut before the activation checklist below is genuinely satisfied.

## Staged rollout (you explicitly choose when to advance - the app never advances a stage on its own)

1. **Simulation only** (current stage) - manually-entered market snapshots, full risk/staking/
   commission pipeline, no real API calls.
2. **Manual Betfair bets** - real market data + real `placeOrders` calls, but every bet requires
   you to click a confirmation modal. No automation.
3. **Automated recommendations, confirmation required** - the system proposes qualifying bets but
   still waits for you to confirm each one.
4. **Small-stake automated betting** - the system submits qualifying bets on its own, within tight
   configured limits.

## Live Betting Activation Checklist (must ALL be true before the switch can even be attempted)

- [ ] Betfair account created, Application Key obtained (Delayed, then Live)
- [ ] Non-interactive (certificate) login working, if betting autonomously
- [ ] `BetfairMarketDataProvider` and `BetfairExecutionProvider` implemented and integration-tested
      against Betfair's sandbox/real API using a mock adapter for automated tests (never place a
      real-money bet from an automated test)
- [ ] Account funds retrievable via the Account API
- [ ] Bankroll explicitly configured (`betfair_bankroll_config.allocated_bankroll`) - never inferred
- [ ] Max stake, daily loss limit, staking method all explicitly configured
- [ ] Commission calculation operational with a real Market Base Rate for the target market
- [ ] Duplicate-bet protection operational (idempotency key + pre-submit order/history check)
- [ ] Risk engine healthy (`evaluateBetCandidate` wired into the real order path, not bypassed)
- [ ] Database healthy

`/betfair`'s automation panel shows a confirmation modal summarising balance, allocated bankroll,
max bet, max daily exposure/loss, staking method, min edge/confidence, and connection status before
any live-betting toggle - even once Stage 2+ makes the toggle real, it must always show this
summary and require an explicit click to confirm.

## Emergency stop

The "STOP LIVE BETTING" button on `/betfair` immediately forces mode back to `SIMULATION`,
sets `live_betting_enabled = false`, and writes an audit log entry. It does **not** cancel existing
matched bets - cancelling eligible unmatched orders is a separate, deliberately distinct action
(not yet implemented, since there's no real order flow to cancel yet).

## Troubleshooting (once Stage 2+ exists)

- Authentication failures, circuit-breaker activations, and Betfair API errors should all write to
  `betfair_audit_log` with a clear `reason` - check there first.
- If live prices aren't available, live betting must show DISABLED - never silently fall back to
  delayed prices for a real-money decision.
