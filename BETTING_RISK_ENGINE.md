# Betting Risk Engine

Core module: `src/lib/betfair/risk-engine.ts` (`evaluateBetCandidate`). Pure function, fully unit
tested (`risk-engine.test.ts`), no I/O - callers gather fresh inputs and call it immediately before
any bet is placed.

## Fail-closed principle

If ANY of the following is true, the decision is `NO_BET` - never "bet anyway with a warning":

- Betfair connection down, market data not live, database unhealthy, risk engine unhealthy, or a
  duplicate bet is detected (`SystemHealth` flags)
- Bankroll unavailable or zero
- Market status isn't `OPEN` (suspended/closed/in-play)
- Price is older than 15 seconds (`MAX_PRICE_AGE_SECONDS`) - callers must reload the price
  immediately before evaluating, not reuse an older recommendation
- Minutes-to-jump outside the configured window
- Racing code/state not permitted, or the code (horse/greyhound) is disabled
- NSW thoroughbred automated betting, unless explicitly enabled (see NSW section below)
- Confidence, edge, commission-adjusted EV, odds range, or liquidity below configured minimums
- Max bets per race/day, max daily stake, daily loss stop, or max total exposure already reached

Only if every check passes does the engine return `{ decision: 'BET', reasons: [] }`. A qualifying
candidate is still just a recommendation - the caller applies staking, liquidity capping, and then
attempts execution (which can itself reject the order, e.g. on a last-second price move).

## Commission (`src/lib/betfair/commission.ts`)

Betfair charges commission on **net market winnings**, not each individual bet. The Market Base
Rate (MBR) is never hardcoded - it's read per-market from `betfair_market_base_rates` (state +
racing code + effective date), because AU rates vary and can change. `commissionAdjustedExpectedValue`
is what gates automated bet qualification (never the raw/pre-commission EV).

## Staking (`src/lib/betfair/staking.ts`)

Six methods: `flat`, `pct-bankroll`, `kelly-0.10`, `kelly-0.25`, `kelly-0.50`, `conservative`.
`kelly-0.50` is the hard ceiling - full (1.0) Kelly is never available. Negative Kelly always
yields a $0 stake (NO BET), never a negative or zero-but-still-qualifying stake. See
`BANKROLL_AND_STAKING.md` for the exact conservative-mode formula.

## NSW turnover charge (`src/lib/betfair/nsw-turnover.ts`)

Tracks weekly matched back turnover vs the (Betfair-documented, re-verify before relying on this)
$1,000/week threshold and 1.25% commission-ratio condition. Warning bands: 75% -> warning, 90% ->
strong warning, 100% -> **blocked by default** (precautionary - turnover is known in advance,
unlike the commission ratio which can only be confirmed after settlement). Automated NSW
thoroughbred betting is disabled by default (`nsw_thoroughbred_auto_enabled = false`); the user can
explicitly re-enable it, at which point only manual bets remain gated behind a warning.

## What's a documented limitation right now

- `betsPlacedTodayForThisRace` and `totalOpenExposure` are stubbed to safe defaults in the current
  API route (`src/app/api/betfair/bets/route.ts`) because settlement isn't implemented yet - there's
  no reliable way to know which bets are still "open" vs settled. Fix this before Stage 2 wires
  real automated betting.
- The order-transaction-rate circuit breaker/backoff described in the original spec is not yet
  implemented - nothing calls the real Betfair API yet, so there's nothing to rate-limit. Must be
  built before Stage 2's `BetfairExecutionProvider`.
