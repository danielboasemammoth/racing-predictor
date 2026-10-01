# Real Betting (TAB) — scaffold, not connected

Status: **TAB provider not connected. No real bets can be placed.** This feature only prepares a durable ledger, a local strategy draft/export page and a local dry-run runner for a future TAB integration.

## Pieces

| Piece | Location | Purpose |
| --- | --- | --- |
| Page | `src/app/real-betting/` | Pick a saved simulator strategy (`racing-saved-strategies-v1`) or import JSON, set risk limits, export a runner config. Admin-only ledger history. |
| Contract/validation | `src/lib/real-betting/config.ts` | Strict strategy interchange parser, risk limits, runner config parser (rejects live modes, `enabled: true`, credentials, non-loopback URLs). |
| Dry-run parsing | `src/lib/real-betting/dry-run.ts` | Server decides the decision; only `BLOCKED_PROVIDER_DISCONNECTED` or `BLOCKED_RISK_LIMIT` are possible. |
| Ledger access | `src/lib/real-betting/ledger.ts` | Service-role reads/writes; reports a missing migration instead of failing. |
| API | `GET /api/real-betting/ledger`, `POST /api/real-betting/dry-run` | Both admin-session gated, `Cache-Control: no-store`. No route writes `real_bets`. |
| Migration | `supabase/migrate-real-betting.sql` | `real_bets` + `real_betting_attempts`, service_role only. **Applied October 1, 2026.** |
| Runner | `scripts/windows/run-real-betting.ps1` | Local runner; disabled or dry-run only. |
| Schedule | `scripts/windows/register-real-betting-task.ps1` | Manual opt-in; registers the task **disabled**. |
| Checks | `scripts/windows/test-real-betting.ps1` | Offline safety checks for both scripts. |

## Strategy draft rules

- The saved list is read from `localStorage['racing-saved-strategies-v1']`. Selecting a strategy does nothing until **Apply as draft** is pressed; the draft is a copy in `real-betting:draft:v1`, so later simulator or preset changes never alter it.
- Imports must match the contract exactly. Preferences that the simulator parser would repair are rejected rather than silently changed.
- Exports are always `{ schema: 1, provider: "tab", mode: "disabled", enabled: false, ... }` with explicit limits (defaults: max stake $5, max $20/day, max $20 open exposure; ceilings $50/$200/$200). Switching to `"dry-run"` is a deliberate local edit of the file.

## Ledger guarantees (migration)

- `real_bets`: idempotency key and provider order ID unique; strategy snapshot/hash, risk limits, quote snapshot, odds, stake and currency are immutable (trigger); rows cannot be deleted; settled rows are final.
- `outcome` (`WON`/`LOST`/`VOID`) requires status `SETTLED`, a provider order ID, a provider settlement reference, `settlement_verified_at`, `settled_at` and a return amount. A return amount without an outcome is rejected. Nothing in the app can currently satisfy this, by design.
- `real_betting_attempts`: append-only, `kind = 'DRY_RUN'` only, decision limited to blocked values. Duplicate idempotency keys are no-ops. Attempts never touch any balance.
- No foreign keys to paper betting tables. No wallet, deposit or withdrawal logic.
- RLS enabled; all privileges revoked from `anon`/`authenticated`; only `service_role` may select/insert (and update `real_bets`).

For a new database, apply `supabase/migrate-real-betting.sql` once via the Supabase SQL Editor (idempotent). Until then the page and `GET /api/real-betting/ledger` report "migration pending".

Activation verified October 1, 2026: the migration was applied to the configured Supabase project. Both tables have RLS enabled, deny reads to `anon` and `authenticated`, and grant the intended service-role access. The application ledger loader returned `ready` with zero bets and zero attempts. No test records, TAB connections, credentials or schedules were created; real wagering remains disconnected.

## Local runner

1. Export a config from `/real-betting`, save it as `%LOCALAPPDATA%\RacingPredictor\real-betting-runner.json`.
2. Validate: `.\scripts\windows\run-real-betting.ps1 -ValidateOnly`.
3. Optional dry-run: edit `"mode": "disabled"` to `"mode": "dry-run"`, start the app locally, then run `.\scripts\windows\run-real-betting.ps1`. It checks `/api/health`, then posts one blocked attempt per 15-minute UTC slot (`dry-run:<configId>:<yyyyMMddHHmm>`), authenticating with the same local admin-session cookie as the daily scripts. Re-runs in the same slot are duplicates.
4. Optional schedule (elevated terminal): `.\scripts\windows\register-real-betting-task.ps1 -IUnderstandDryRunOnly`. The task is created disabled; enable it yourself with `Enable-ScheduledTask -TaskName RacingPredictor-RealBettingDryRun`.

The runner refuses any other mode, `enabled: true`, unknown fields, credential-like keys and non-loopback URLs (no redirects followed). `Invoke-TabProvider` is a fail-closed placeholder and is never called.

## Credentials (future)

TAB credentials must never be stored in the repo, the runner config, the browser or the app/server. When an integration exists, store them per Windows user with DPAPI, typed directly in a local terminal:

```powershell
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\RacingPredictor" | Out-Null
Get-Credential | Export-Clixml "$env:LOCALAPPDATA\RacingPredictor\tab-credentials.xml"
```

The current runner does not read this file.

## Not done (future scope)

- Any TAB authentication, quote, placement or settlement call. Endpoints and auth must come from TAB's official API documentation and approved access; none are assumed here.
- Live writes to `real_bets`, settlement verification, reconciliation and order status polling.
- Candidate selection from live quotes in the runner (dry-run currently records a heartbeat attempt with no proposal).
- Wallet, deposit and withdrawal handling.

TAB's public root at https://api.beta.tab.com.au/ points to https://studio.tab.com.au and its versioned API, but does not establish approved wagering access. No authentication or order endpoint is inferred from that root. Racing.com recorded prices are not guaranteed executable TAB quotes. Future provider integration must verify market/runner IDs, fresh executable odds, slippage limits, idempotent submission and unknown-order reconciliation before any stake is committed.

Consolidated bankroll is future scope: a reporting balance can aggregate providers, but deposits, withdrawals and legally held funds still belong to provider accounts unless an approved custody/payment arrangement exists. This scaffold neither moves money nor promises cross-provider funds transfer.
