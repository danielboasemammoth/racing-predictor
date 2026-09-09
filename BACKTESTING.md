# Backtesting

## Three different validation methodologies exist in this repo - use the right one for the question

| Methodology | Where | Split | Use for |
|---|---|---|---|
| Single static 60/20/20 | `train-logit-weights.ts`, `feature-ablation.ts`, `train-place-model.ts` | chronological slice, test only looked at once | Training/selecting a specific weight vector or threshold |
| Single static 70/30 discovery/holdout | `reliability-analysis.ts` | chronological | Discovering which race-segments/probability-bands replicate out-of-sample |
| **Rolling walk-forward** | `walk-forward-backtest.ts` (new) | grows forward one calendar month at a time, per spec section 4's own example ("train Jan-Apr, validate May; train Jan-May, validate June...") | Checking whether performance is stable/consistent through time, not just in one lucky/unlucky split |
| Full-history batch re-score | `/api/admin/backtest` route, `accuracy_log`/`predictions.actual_results` | all completed races, latest prediction per model version | Powering the live `/accuracy` dashboard - naturally leakage-safe because it only ever scores races that have already completed, but it is NOT itself a walk-forward experiment design |

**None of these ever randomly shuffle races across a train/test boundary** - every split in this
repo is chronological, consistent with spec section 4's explicit requirement.

## Running a walk-forward validation

```
npx tsx --env-file=.env.local scripts/walk-forward-backtest.ts
```

This is read-only: it prints a per-calendar-month report (production ensemble vs the required
baselines - market favourite, simple recent-form-only, simple unweighted-average-rating, and an
analytically-computed random-ranking baseline), writes `scripts/output/walk-forward-backtest.json`
(gitignored, local convenience copy), and publishes a summary to Supabase
(`analysis_snapshots`, `kind='walk-forward-backtest'`) so a future dashboard can read it without
re-running the script. It defaults to a 3-calendar-month burn-in before scoring the first window
(`BURN_IN_MONTHS` constant) - with only ~4 months of completed-race history in this dataset today,
that currently produces exactly one scored window; it will produce more as more months of race
data accumulate. Re-run this periodically (e.g. monthly) rather than treating one window's result
as final.

## Backtest integrity (spec section 52)

- Every feature is computed from `history.filter(start => start.raceDatetime < targetTime)` - a
  race can never see its own future or a later race's data (see PREDICTION_ARCHITECTURE.md's Data
  Leakage section).
- All chronological splits in this repo compute the split boundary from `race_datetime`, sorted
  ascending, and the test/holdout slice is always the LATEST slice, never re-mixed with
  training/validation data afterward.
- `predictions` rows are insert-only (no unique constraint, no update-in-place) - a new prediction
  run creates a new row rather than overwriting a prior one, so a retrospective/backtest
  prediction is never indistinguishable from - or capable of overwriting - the original live
  prediction that existed before the race ran. `model_version` strings ending in
  `-retrospective` (e.g. `v4-connections-retrospective`) mark backfilled/replayed predictions
  distinctly from the live `v4-connections` version used at prediction time.
- There is no dedicated *automated test* asserting "a training feature can never include a future
  race's data" (spec section 52 asks for one) - today this is enforced entirely by the
  `availableHistory` filter's own correctness and the audits performed in this and prior sessions,
  not by a regression test. Adding one would mean constructing a synthetic history array with a
  deliberately "future" start and asserting `buildFeatures()` ignores it - a reasonable follow-up,
  not yet done.

## Running the other backtests

- `npx tsx --env-file=.env.local scripts/train-logit-weights.ts` (or `-kfold`) - re-fits `v5-trained`'s weights.
- `npx tsx --env-file=.env.local scripts/feature-ablation.ts` - feature-group ablation.
- `npx tsx --env-file=.env.local scripts/reliability-analysis.ts` - republishes the live Reliability Score calibration table + historical feature rows used by the Segment Explorer (`/admin/research`) and the home page's Reliability Score. **As of 2026-09-09 this also runs automatically every night** as the "Refresh Reliability Calibration" step in the scheduled daily pipeline (`scripts/windows/run-daily-tasks.ps1` -> `/api/admin/reliability-refresh`, shared logic in `src/lib/reliability-refresh.ts`) - the script itself is now a thin wrapper that also prints the full discovery/holdout diagnostic report, useful for a periodic manual review but no longer required just to keep the calibration current.
- `npx tsx --env-file=.env.local scripts/train-place-model.ts` - separate PLACE-target experiment (see MODEL_RESEARCH.md).
- `POST /api/admin/backtest` (admin-authenticated, or via the "Run Backtest" button on `/admin`) - full-history batch re-score powering `/accuracy`.

All of the above are safe to re-run any time - none of them mutate production model weights or the
live `predictions` used by the home page; they only read history and (for the two scripts that
publish to Supabase) upsert an `analysis_snapshots` row keyed by `kind`.
