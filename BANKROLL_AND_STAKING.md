# Bankroll and Staking

## Bankroll allocation is not a deposit/withdrawal mechanism

`betfair_bankroll_config` (singleton row, `/betfair` dashboard) lets you set:

- **Allocated bankroll** - the maximum the app will ever expose to automation. Increasing your
  actual Betfair balance never automatically increases this.
- **Reserve** - money automation must never touch (informational limit in Stage 1; enforced once a
  real Betfair balance exists in Stage 2, via `min(allocated_bankroll, actual_balance - reserve)`).
- **Bankroll ceiling / withdrawal threshold / top-up threshold** - purely advisory. Crossing the
  withdrawal threshold shows "Profit withdrawal suggested"; falling below the top-up threshold
  shows "Bankroll below configured level". Neither ever triggers an automatic transfer - all
  deposits/withdrawals stay manual, through Betfair directly.

## Changing your starting simulated bankroll

Same rebase convention as the existing PuntersEdge paper-betting bankroll: changing
`simulated_starting_bankroll` preserves your current net profit/loss (only the reference point
moves), rather than wiping accumulated simulated history.

## Staking methods (`src/lib/betfair/staking.ts`)

| Method | Formula |
|---|---|
| `flat` | Fixed dollar amount (`flat_stake_amount`), capped by `maxBet`/`maxPctBankroll` |
| `pct-bankroll` | `bankroll * pct_bankroll_stake` |
| `kelly-0.10` / `kelly-0.25` / `kelly-0.50` | `bankroll * kellyFraction(odds, p) * multiplier` |
| `conservative` | see formula below |

Kelly fraction (reused from `src/lib/betting/kelly.ts`, single source of truth): for decimal odds
`O`, `b = O - 1`, `p` = model probability, `q = 1 - p`: `f = (b*p - q) / b`. Negative `f` always
means $0 stake (NO BET) - never a negative stake.

### Conservative mode formula (documented, not an unexplained black box)

```
base                = bankroll * kellyFraction(odds, p) * 0.25       (quarter-Kelly)
confidenceAdjusted  = base * confidence                              (confidence in 0-1)
uncertaintyAdjusted = confidenceAdjusted * (1 - modelUncertainty)     (modelUncertainty in 0-1)
final               = min(uncertaintyAdjusted, liquidityAvailable * 0.20)
```

Then the same `maxBet`/`maxPctBankroll` limits are applied on top, exactly as with every other
method - conservative mode is never allowed to bypass the hard caps.

## Limits always applied last

Every staking method's raw output is passed through the same clamp: `min(rawStake, bankroll *
maxPctBankroll, maxBet)`, and separately capped to `liquidityAvailable * maxLiquidityConsumptionPct`
(never consume more than the configured share of visible liquidity). There is no path that skips
these caps.

## No martingale, ever

There is no loss-chasing, stake-doubling, or automatic bankroll replenishment anywhere in this
codebase, and none should ever be added. Stakes are only a function of bankroll, model probability,
price, and the configured risk limits above.
