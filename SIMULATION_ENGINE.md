# Simulation Engine

## Scope right now (Stage 1)

The simulation engine mirrors real Betfair execution mechanics as closely as practical without a
real market data feed:

- **Limit-order fills**: `SimulationExecutionProvider` (`src/lib/betfair/providers.ts`) fills up to
  the available size at the quoted price, partially fills if requested size exceeds available
  liquidity, and rejects outright if the price has moved worse than your minimum acceptable price -
  it never "fills at a worse price than you asked for".
- **Commission**: every simulated bet's commission-adjusted edge/EV is computed the same way real
  bets will be (`src/lib/betfair/commission.ts`), using a market base rate you supply (never
  hardcoded).
- **Risk engine**: every simulated bet runs through the exact same `evaluateBetCandidate` fail-closed
  gate that a real automated bet would (same code, not a separate "demo" path).

## What the simulation does NOT do yet

- It does not read a real market - you (or, later, a scheduled job) supply the "current price" and
  "available liquidity" manually via `/betfair`'s testing form or the `/api/betfair/bets` POST body.
- It does not settle bets. A simulated bet is created as `MATCHED`/`PARTIALLY_MATCHED` and stays
  there - there's no automatic transition to `WON`/`LOST` yet, since that requires a results feed.
  Build this before relying on the simulation for calibration/backtesting decisions.
- It does not model scratches, non-runners, void markets, or dead heats yet.

## Separate ledgers

`betfair_bets.bet_mode` (`SIMULATION` / `LIVE_MANUAL` / `LIVE_AUTO`) keeps this entirely separate
from the existing PuntersEdge `paper_bets` table (a different, older paper-betting system) and from
any future live Betfair ledger. Never write cross-ledger aggregate stats that blend these.

## Simulated bankroll

`betfair_bankroll_config.simulated_starting_bankroll` / `simulated_current_bankroll` are the
Stage 1 simulation ledger's bankroll fields. Stake is not yet deducted at placement (only tracked
as "requested/matched stake" on the bet row) because settlement - the point at which a stake is
actually realised as won/lost - isn't implemented yet. Once settlement exists, bankroll updates
should happen at settlement time only, matching how the existing PuntersEdge paper-betting system
already does this (see `src/lib/paper-betting/repository.ts`'s settlement path for the pattern to
follow).
