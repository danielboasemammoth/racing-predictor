# Calibration

## Two different things this repo calls "calibration" - do not conflate them

1. **Betting-outcome calibration** (`src/lib/betting/calibration.ts`) - fixed-width probability
   buckets (5pp wide), Brier score, log loss, `credibleBuckets()` (n >= 30 only). Used by the
   PuntersEdge paper-betting Model Validation dashboard (`/paper-betting`) to check whether
   BET-decision probabilities line up with real settled outcomes, and by
   `src/lib/betting/drift-detection.ts` to flag deterioration.
2. **Reliability Score calibration** (`src/lib/reliability-score.ts` /
   `src/lib/reliability-analysis.ts`) - a tiered-relaxation **comparable-cohort** strike rate
   (Wilson 95% CI + empirical-Bayes shrinkage toward baseline), rescaled onto a 0-100 score. This
   is what powers the home page's Reliability Score / Conservative Shortlist gate. It answers
   "historically, when the model was this confident with this much separation and this much
   agreement, how often was it actually right?" - it is not a probability recalibration of the
   model's own output, it's an evidence-based confidence label layered on top of it.

Neither of these currently applies isotonic regression, Platt scaling, or temperature scaling to
the win-probability model's own output.

## Why isotonic/Platt-style recalibration of the win-probability model was tried and rejected

`scripts/experiment-probability-calibration.ts` built exactly this (rescale each horse's
`win_probability` to the discovery-slice's observed strike rate for its probability band,
renormalize across the field) and tested it on a genuine chronological holdout. Result: Brier
score and log loss both got **slightly worse** (0.0936 vs 0.0930 Brier, n=151 holdout races) -
bands above ~30% probability only had 19-54 holdout samples and produced a non-monotonic curve
that didn't generalize. This is not a bug or an implementation mistake - it is a real, validated
negative result, and per this project's honesty convention it was not implemented. It should be
retried once there is materially more holdout data (this dataset only spans ~4 calendar months at
the time of writing - see MODEL_RESEARCH.md), not assumed to remain negative forever.

## Do not show false precision (spec section 20)

The home page and `/accuracy` display probabilities/scores as whole percentages (e.g. "83%"), not
`82.7341%`. If you add a new probability display anywhere, round to whole percentage points (or at
most one decimal place for a research-only admin table like Segment Explorer, where an extra digit
helps distinguish close segments for an operator, not an end user).

## Metrics available today

- **Brier score** and **log loss** - `src/lib/betting/calibration.ts` (betting outcomes),
  `src/lib/backtest.ts::evaluatePrediction` (winner-only, stored per prediction as
  `winner_brier_score`/`winner_log_loss` in `actual_results`), and now
  `scripts/walk-forward-backtest.ts` / `scripts/train-place-model.ts` (research-only, printed not
  stored per-prediction).
- **Expected Calibration Error (ECE)** - not implemented as a named metric; the bucket tables in
  `calibration.ts` and the Segment Explorer (`/admin/research`) let you read the same information
  off a table (predicted vs observed per band) without a single scalar ECE number. Add one only if
  a concrete need for the single-number summary shows up.
- **Win vs Place calibration, separately** - Brier/log loss are computed separately for Win
  (`backtest.ts`, walk-forward script) and, as of this session, for Place
  (`train-place-model.ts`, comparing the trained classifier against the current Harville-derived
  approach). There is still no live `/accuracy` display of Place-specific calibration - only Win
  calibration is shown there today (see the "Not yet done" list below).

## Not yet done

- Live `/accuracy` display of Place-specific Brier/log loss/calibration curve (Win-only today).
- A single ECE number, if ever needed.
- Re-attempting isotonic/Platt calibration once more holdout data exists.
