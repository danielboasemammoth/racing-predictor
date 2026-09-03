# Betfair Integration

## Status: Stage 1 (architecture + simulation only)

No Betfair account is connected. There are no API credentials configured, and no
`BetfairMarketDataProvider`/`BetfairExecutionProvider` implementation exists yet. Everything in
this stage runs against a manually-entered or simulated market snapshot - **no live/delayed
Betfair API calls happen anywhere in the codebase yet.**

## Architecture

```
Prediction engine (existing, unchanged)
        |
        v
Provider abstractions (src/lib/betfair/providers.ts)
  - MarketDataProvider   (reads price/liquidity/status)
  - ExecutionProvider    (places orders)
        |
        v
  SimulationExecutionProvider (Stage 1, implemented)
  BetfairMarketDataProvider   (Stage 2+, NOT implemented)
  BetfairExecutionProvider    (Stage 2+, NOT implemented)
```

The prediction engine, risk engine, staking, and commission math never talk to Betfair directly -
they only depend on the interfaces in `providers.ts`. This means Stage 2 (wiring real Betfair data)
should not require changing the risk/staking/commission logic at all, only adding new provider
implementations.

## Application key modes

Three modes are planned: `BETFAIR_DISABLED`, `BETFAIR_DELAYED`, `BETFAIR_LIVE`. Stage 1 is
effectively always `BETFAIR_DISABLED` - the mode isn't configurable yet because there's nothing to
switch to. When Stage 2 adds real credentials, delayed data must never be silently used for
real-money decisions - if live prices aren't available, live betting must be disabled, not
downgraded to delayed prices.

## Data source strategy: PuntersEdge + Betfair combined

Betfair's free "Delayed" application key lags the real market (commonly a minute or more) - fine
days out from a race, unreliable in the volatile final few minutes before the jump. PuntersEdge's
TAB-derived prices are already effectively live in this codebase. Policy
(`src/lib/betfair/market-data-policy.ts`, `selectMarketDataSource`):

| Betfair mode | Minutes to jump | Source used for VALUE/recommendation display |
|---|---|---|
| `BETFAIR_DISABLED` | any | PuntersEdge |
| `BETFAIR_DELAYED` | <= 15 min | PuntersEdge (delayed Betfair price too stale to trust) |
| `BETFAIR_DELAYED` | > 15 min | Betfair (acceptable approximation further from the jump) |
| `BETFAIR_LIVE` | any | Betfair (accurate AND the actual execution venue) |

This only governs which price informs a *recommendation*. It never changes the fail-closed
execution rule: any real order always reloads Betfair's own live price immediately before
submitting (see `BETTING_RISK_ENGINE.md`'s `MAX_PRICE_AGE_SECONDS` check) - a PuntersEdge/TAB price
is a different market and is never directly executable on Betfair. This policy function exists now
(Stage 1) as a documented decision ready for Stage 2 to wire up; there is no real Betfair feed yet
to actually apply it to.

## Database (see `supabase/migrate-betfair-stage1.sql`)

New tables, entirely separate from the existing PuntersEdge `paper_accounts`/`paper_bets`
(never mix simulated Betfair bets with the PuntersEdge paper-betting ledger):

- `betfair_market_base_rates` - configurable commission rates (never hardcode a rate)
- `betfair_bankroll_config` - singleton row, allocation/reserve/thresholds
- `betfair_risk_settings` - singleton row, all automated-betting risk rules
- `betfair_automation_state` - singleton row, mode + live-betting switch
- `betfair_bets` - unified bet ledger (`bet_mode` distinguishes SIMULATION/LIVE_MANUAL/LIVE_AUTO)
- `betfair_nsw_turnover_weekly` - NSW turnover-charge tracking
- `betfair_audit_log` - immutable-ish audit trail

## What's NOT built yet (explicitly deferred to Stage 2+)

- Any real Betfair API call (auth, market catalogue, price streaming, placeOrders, account funds)
- Non-interactive certificate login
- Real race-card integration on the home page (Betfair price columns, recommended stake per race)
- Settlement of simulated bets (bets currently stay MATCHED/PARTIALLY_MATCHED forever - no
  WON/LOST transition is implemented yet, since that needs a results data source)
- CLV tracking (needs a real near-start price snapshot to compare against)
- Transaction-rate circuit breaker / rate limiter against the real API (nothing to rate-limit yet)

## Before advancing to Stage 2

You will need: a Betfair account, an Application Key (Delayed first, Live only once you intend to
test real order placement), and - for autonomous/non-interactive use - a client SSL certificate
registered against your account for certificate ("bot") login. Verify the current login/endpoint
details against [the official Betfair developer docs](https://developer.betfair.com/) at
implementation time, since these prompts/docs can go stale.
