# Scheduled Tasks

Run these from the project root in Administrator PowerShell to activate the intended schedule:

```powershell
.\scripts\windows\register-task.ps1
.\scripts\windows\register-puntersedge-poll-task.ps1
```

Both tasks run at midnight and hourly from 06:00 through 23:00, using local Windows time. The poll registration disables the obsolete morning and late catch-up tasks. Editing scripts alone does not change registered triggers. Hourly odds polling can miss prices available only 15-25 minutes before jump.

The main pipeline requires successful race and result syncs before generating upcoming predictions. Retrospective backfill runs afterward, at most 50 races per invocation; its failure does not block later maintenance. Backfill, backtest, calibration, auto-betting, settlement, odds sync, and pruning failures are recorded while subsequent steps continue. A failed step produces a nonzero process exit code, forwarded by the hidden launcher. Some backfill work may remain for the next hourly run.

Tasks use `IgnoreNew` while a prior instance is running. The main pipeline has a three-hour execution limit, so long runs can skip hourly triggers. Inspect the timestamped `logs/daily-tasks-YYYY-MM-DD.log` and `logs/puntersedge-poll-YYYY-MM-DD.log` as well as Task Scheduler's last result. Logs are UTF-16 on Windows PowerShell 5.1.

```powershell
Get-ScheduledTask -TaskName 'RacingPredictor-*' | Get-ScheduledTaskInfo
.\scripts\windows\test-daily-pipeline.ps1
```

The regression check mocks service calls and task-trigger creation; it does not register tasks, ingest data, or place bets.

## Homepage Picks

The main public pages use persisted page snapshots; see [PAGE_CACHING.md](PAGE_CACHING.md) for refresh scopes, freshness limits, and recovery commands. Both task scripts attempt relevant snapshot refreshes in `finally`, before stopping a self-started app, including after a failed upstream step. Existing registered triggers need no changes for these script updates. Rebuild the production app so task-started instances include the refresh endpoint.

App detection uses the database-independent `/api/health` endpoint, so a slow or unavailable Supabase connection does not make the scheduler misidentify a running app.

The PLACE watchlist lists recorded top-three probabilities of at least 50% for all forecast runners, independently of WIN reliability. Forecast timestamps and race coverage are displayed for today and tomorrow. These are model estimates, not value-qualified betting recommendations; top-three probability does not imply a three-place paid market.

Conservative picks retain their existing reliability gate and probability controls (default WIN >=50%). Their empty states distinguish unavailable reliability, missing forecasts, and filtered candidates. Neither the watchlist nor these display changes alters auto-betting policy or promotes a model.

The shared homepage loader reads current-model forecasts in 20-race batches and paginates each batch, avoiding Supabase's 1,000-row response cap. It keeps the newest snapshot per model and stops once all current models are present for every race in the batch.

## Ingestion Failures

Racing.com can supply a synthetic entry (`999{raceId}-{horseCode}`) alongside the canonical entry for the same horse. The shared race reader prefers the canonical record independent of feed order when finishing position and scratching status agree. Conflicting outcomes or ambiguous duplicate canonical records abort ingestion rather than silently changing results. This prevents duplicate-key upsert failures (`21000`) for the confirmed synthetic-record case.

Prediction reads retry bounded transient Supabase failures, including HTTP 520/522 responses returned as `{ error }`, not just thrown network exceptions. Prediction inserts are not automatically retried because an upstream timeout can occur after the database committed a write.

Prediction snapshots are saved in sequential batches of 20 records. On September 22, race/result ingestion succeeded but the previous 500-record inserts hit PostgreSQL `57014` at `save-predictions`, aborting each main run and leaving only 4 of 66 today/tomorrow races with forecasts. Smaller writes completed successfully, restoring 66/66 forecasts; a direct Racing.com comparison confirmed all nine meetings and runner counts matched. Prediction errors now report the failing stage and database error code. Partial successful live batches remain immutable; failed writes are not automatically retried.