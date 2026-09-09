# Model Research

The research/experimentation methodology used to validate (or reject) modelling ideas before they
are ever allowed near production, and the concrete findings produced so far. Every experiment here
follows the same discipline: chronological (never randomly shuffled) train/validation/test splits,
a confirmatory test split that is only looked at once, and comparison against baselines - a
positive validation result is never enough on its own to promote a challenger (see
MODEL_PROMOTION.md).

## Research scripts (all read-only, run manually via `npx tsx --env-file=.env.local scripts/<name>.ts`)

| Script | Question | Split | Status |
|---|---|---|---|
| `train-logit-weights.ts` / `train-logit-weights-kfold.ts` | Do gradient-descent-fitted weights beat hand-tuned ones? | 60/20/20 chronological | `v5-trained` shipped as its own tracked model version - modest edge (0.2672 vs 0.2654 validation objective), not promoted to primary |
| `feature-ablation.ts` | Which feature groups actually help? | 60/20/20 chronological | Standalone diagnostic, re-run periodically |
| `experiment-market-reranker.ts` | Does blending in the market beat the pure fundamentals model? | 70/30 chronological discovery/holdout | Pure market (33.8-37.4%) beat the fundamentals model (21.8%) at every blend ratio tested |
| `experiment-ensemble-membership.ts` | Does a 4-model ensemble beat the current 2-model one? | chronological replay | Wash (+0.5pt, worse Brier/logLoss) - not implemented |
| `experiment-probability-calibration.ts` | Does band-based post-hoc calibration help? | genuine holdout | Made Brier/logLoss slightly WORSE - not implemented (see CALIBRATION.md) |
| `walk-forward-backtest.ts` **(new)** | Rolling month-by-month walk-forward vs market-favourite/random/average-rating baselines | rolling, growing history | See findings below |
| `train-place-model.ts` **(new)** | Does an independently-trained PLACE classifier beat the Harville-derived place probability? | 60/20/20 chronological | See findings below |
| `reliability-analysis.ts` | Which race segments/probability/gap/agreement bands actually replicate out-of-sample? | 70/30 chronological discovery/holdout | Only probability/gap/agreement replicated; publishes the live calibration table |

## Finding: the production ensemble does not currently beat the market (re-confirmed)

`walk-forward-backtest.ts`'s first genuine rolling window (2026-09, 347 races, after a 3-month
burn-in seeding period) measured:

| Approach | Winner accuracy | Winner Brier term | Winner log loss |
|---|---|---|---|
| Production ensemble (v4.1-ensemble) | 14.1% | 0.788 | 2.22 |
| **Market favourite** (cheapest recorded price) | **36.4%** | **0.619** | **1.71** |
| Average rating (unweighted mean of the 13 features) | 13.0% | 0.789 | 2.22 |
| Recent-form only | 9.8% | 0.789 | 2.22 |
| Random ranking (analytical expectation) | 11.2% | n/a | n/a |

This reconfirms the earlier `experiment-market-reranker.ts` finding (see
`/memories/repo/racing-predictor.md`): the model beats a naive random-ranking floor and a naive
unweighted-average-rating baseline, but is comfortably beaten by simply backing the market
favourite. Per spec section 6, this means the production ensemble does **not** currently add
predictive value beyond the market on this sample. Only 4 calendar months of completed-race
history currently exist in this dataset, so this is one rolling window, not yet many - re-run this
script periodically as more months accumulate; do not treat one window as final, but do not ignore
a result this large either.

## Finding: an independently-trained PLACE model does NOT beat the current Harville-derived approach

`train-place-model.ts` trains a genuinely separate PLACE target (logistic regression, "did this
runner finish in an actual TAB-payable place", same 13 features as the win model, per spec section
9) and compares it out-of-sample against the current production approach (Harville's formula
applied to the win model's own probabilities - the only place logic that existed anywhere in this
repo before this experiment), on a chronological 60/20/20 split (1941/647/648 races).

| | Validation Brier | Validation log loss | Test Brier | Test log loss |
|---|---|---|---|---|
| Trained place-logistic (best L2=0.001) | 0.2030 | 0.5938 | 0.2026 | 0.5930 |
| Harville-derived (current production) | 0.2004 | 0.5890 | 0.2004 | 0.5877 |

The independently-trained classifier is very slightly WORSE than the existing Harville-derived
place probability on both metrics, on both the validation and the untouched confirmatory test
split. This is a genuine, honest negative result, consistent with this project's established
practice of reporting negative findings rather than only positive ones (see
`experiment-probability-calibration.ts`/`experiment-ensemble-membership.ts` in the table above).
**Conclusion**: the current Harville-derived approach - deriving place probability from the win
model rather than training a separate target - is not actually the weakness the spec assumed it
might be; it already outperforms a straightforward independently-trained alternative on this
dataset. Per spec section 56/57, no change was made to production place logic. This should be
re-tested once materially more historical data exists (same caveat as the walk-forward finding
above - this dataset spans ~4 calendar months), and a genuinely different approach (e.g. a
pairwise/ranking-based place model, rather than independent per-runner logistic regression) could
still be worth trying later - simple independent logistic regression may just be too crude a
model class for this particular target given how correlated "who places" is within a single race.

## Not yet done: pairwise modelling and learning-to-rank

No pairwise ("which of runner A/B finishes ahead") or learning-to-rank (LambdaRank/XGBoost-style)
model exists in this repo. `package.json` has no gradient-boosting or ML library installed - only
`@supabase/*`, Next.js/React, and dev tooling. Implementing either would currently mean either (a)
a pure-TypeScript pairwise logistic model in the same self-contained-script style as
`train-logit-weights.ts`/`train-place-model.ts` (feasible, no new dependency), or (b) adding an
external ranking library, which is a bigger decision (new dependency, build/deploy implications on
Vercel) that should be made deliberately rather than as a side effect of this session's work. Given
the walk-forward finding above (the current model does not beat the market baseline at all), the
higher-priority next step is investigating candidate generation/features rather than a fancier
re-ranker - the same conclusion the 2026-09-02 `prediction-error-analysis.ts` finding already
reached (only 27.9% of losses were "close" - winner ranked #2/#3; 46.5% weren't in the model's top
5 at all).

## Feature importance / ablation

`feature-ablation.ts` already implements walk-forward feature-group ablation (form, suitability,
connections, barrier, weight, fitness, classMovement) with an out-of-sample objective. No
permutation-importance or SHAP analysis exists yet - lower priority than the candidate-generation
question above per the same reasoning.
