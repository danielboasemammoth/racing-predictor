# Model Promotion (Champion / Challenger)

## Current state - informal, not automated

- **Champion (production)**: `v4.1-ensemble` (`CURRENT_MODEL_VERSIONS` in
  `src/lib/prediction-suite.ts`) - the only model version read by the home page's
  Conservative Shortlist (`daily-picks.ts`).
- **Challenger**: `v6-market-blend` (`src/lib/market-blend-model.ts`) - generated and stored
  alongside the Champion on every prediction run, accumulating its own live track record, but not
  read by any user-facing page.
- Every other tracked version (`v4-baseline`, `v4-context-form`, `v4-connections`, `v4-optimized`,
  `v5-trained`) exists purely for comparison on `/accuracy` and in research scripts - none of them
  is a "challenger" in the promotion sense, they're the Champion's own component/comparison set.
- Promotion today is **entirely manual**: a human reviews `/accuracy` and/or a research script's
  printed report and decides whether to change which config(s) `PRODUCTION_ENSEMBLE_CONFIGS`
  (prediction-suite.ts) points at, or whether to swap `daily-picks.ts` to read a different model
  version. There is no automated A/B rollout, staged traffic split, or promotion gate enforced in
  code.

## Promotion criteria (spec sections 38/57) - applied as a checklist today, not enforced by code

A challenger should only be promoted over the Champion once **all** of the following hold on a
genuine out-of-sample split (never the training data):

1. It beats the Champion's calibration (Brier score AND log loss), not just one of the two.
2. It beats the Champion's ranking/accuracy metric relevant to the claim being made (winner
   accuracy for a win-model challenger; Brier+logLoss on the "placed" label for a place-model
   challenger - see `train-place-model.ts`).
3. It does not meaningfully worsen paper/backtest ROI or drawdown where that's measurable.
4. The out-of-sample sample size is large enough that the result isn't noise (this project's
   working convention elsewhere is `MIN_CREDIBLE_SAMPLE = 30`; for a promotion decision, prefer
   materially more than that where possible - e.g. `experiment-market-reranker.ts`'s finding used
   hundreds of holdout races).
5. The result has been prospectively spot-checked against at least one or two SUBSEQUENT batches
   of real data before being considered "done" - see the 2026-09-06 postmortem in
   `/memories/repo/racing-predictor-notes.md` ("Tuning/tracking register") for a real case where a
   threshold tuned on a 2-3 day sample was overfit and had to be corrected the very next day.

None of `v5-trained` or `v6-market-blend` currently meet criterion 4 well (this dataset spans ~4
calendar months total) - they are correctly still Challengers, not Champions, regardless of any
single split's result. The independently-trained PLACE model experiment (see MODEL_RESEARCH.md)
did not even clear criterion 1/2 (it was slightly worse than the existing Harville-derived
approach on both Brier score and log loss) - it is a rejected experiment, not a Challenger.

## What would need to change to promote a challenger today

There is no "promote" button or flag. Promotion means a deliberate code change:
- For a new WIN model: add it to `PRODUCTION_ENSEMBLE_CONFIGS` (prediction-suite.ts) and/or change
  what `daily-picks.ts` treats as `primary`.
- For a new PLACE model: replace the call to `harvillePlaceProbabilities()` in
  `prediction-v3.ts::placeProbabilities()` with the new model's output (and do the equivalent in
  the PuntersEdge side, `src/lib/betting/harville.ts`'s callers, if promoting there too - these are
  two independent codepaths, see PREDICTION_ARCHITECTURE.md's "Two separate systems" section).
Either change should be its own commit, with the before/after metrics from the relevant research
script quoted in the commit message, matching this project's existing commit-message convention
(state what changed, why, and what verification was performed).

## Model versioning gaps (spec section 37)

`predictions` rows store `model_version` and `predicted_at` (effectively the prediction
timestamp), which is enough to distinguish live vs retrospective runs of any given model version.
They do **not** store a separate `training_cutoff` date or `feature_engineering_version`. This has
not mattered in practice yet because every model version to date used a fixed, hand-tuned or
one-off-trained weight vector (baked into source code, not re-trained on a rolling schedule) - if a
model is ever retrained on a recurring schedule (e.g. `v5-trained` refreshed monthly), these two
fields should be added to the `predictions` schema at that point so historical reports can tell
which training run produced which prediction.
