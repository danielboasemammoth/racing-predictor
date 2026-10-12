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
| `experiment-market-residual.ts` **(new)** | Do 32 time-safe features beat the closing price, especially for non-favourite winners? | 60/20/20 chronological | No - see the 2026-10-12 finding |
| `experiment-odds-movement.ts` **(new)** | Do steamers/drifters (3h/8h price movement) add to the price? | 60/40 chronological | No - see the 2026-10-12 finding |

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

## Finding (2026-10-12): non-favourite winners cannot be reliably identified from the data we hold

Question: 62% of races are won by a non-favourite - can anything find those winners? Two read-only experiments, both chronological with a confirmatory test split.

`experiment-market-residual.ts` (4,959 priced completed races; 992 test races; market = official starting price, a harder baseline than the live feed price) fits `score = b1*log(p_market) + b2*log(p_market)^2 + g.x` with x = the existing 13 features plus 19 new time-safe ones (freshness/first-up, career and last-start form, handicap rating and weight vs the field, barrier, early pace and pace-vs-field interaction, 60-day jockey/trainer strike rate, jockey change, form vs market expectation, proven at distance/condition/course).

| Test split | Log loss | Top-1 | Notes |
|---|---|---|---|
| Pure market (SP) | 1.7075 | 38.0% | favourite wins 38.0% |
| Market + longshot curve | **1.6970** | 38.0% | only real gain: favourites win MORE than priced, longshots LESS |
| Market + existing 13 features | 1.6955 | 37.5% | gain over the curve alone is 0.0015 |
| Market + 19 new features | 1.7019 | 37.3% | worse than the curve alone |
| Market + all features | 1.7026 | 36.1% | overfits |

- Market calibration on test: runners priced 0-5% win 1.6% (priced 2.5%); 40-60% win 55.6% (priced 47%); 60%+ win 81% (priced 66%). Backing every 60%+ runner at SP returned +2.6%, every other band lost 2-53%.
- Wherever the fitted model disagrees with the favourite it loses: its pick wins 15.9-21.6% of the time versus 26.7-30.3% for the favourite in the same races, with ROI@SP of -19% to -40%. A "non-favourite with model/market ratio >= 1.5" band showed +43% ROI on 44 test bets but -51% on 25 validation bets: noise, not an edge.
- Largest standardized coefficients beyond the price are all about 0.06 or smaller (jockey change, partnership form, barrier position); none replicate across validation and test.

`experiment-odds-movement.ts` (1,958 races since 2026-08-18) tests steamers/drifters from the hourly price snapshots stored with each prediction. Adding 3-hour and 8-hour price movement made test log loss worse (1.7845 -> 1.7936/1.8091); firmed runners won 16-17% against 15% priced and drifters 4.4% against 4.9%, too small to matter. The last stored snapshot is a median 174 minutes before the jump, and TAB snapshots are only hourly, so close-to-jump money cannot be tested with the retained data.

Conclusions:
- Backing the favourite is still the accuracy ceiling (38%) and every tested fundamentals signal fails to add reliable information to it. v6-market-blend is already about 90% market and cannot do worse than that; the 10% fundamentals weight contributes about 0.0015 log loss.
- Non-favourites are not predictable enough from form, ratings, weight, barrier, pace, jockey/trainer or the price history we store. They also win LESS often than their price implies, so "value" hunting among them loses on average.
- The calibration gain (favourites underpriced) is real on SP but was NOT promoted: it was fitted to closing prices, and on the earlier stored feed prices the curve had the opposite sign and a 0.001 benefit. A calibration must be fitted on the same price the picks actually use (price at selection time) before any promotion under MODEL_PROMOTION.md.
- Data that could plausibly change this and is not retained: dense TAB/exchange price history in the final 30 minutes (money movement), tote-vs-fixed gaps, sectional/pace-map data beyond Racing.com's standard-time difference, gear changes (sparse), track-bias and rail position, trial results, and weather forecasts. Capturing the final-30-minute TAB price path is the most promising next step.

Re-run with `npx tsx scripts/experiment-market-residual.ts` (add `--refresh` to reload data; the data is cached under the ignored `scripts/output/`) and then `npx tsx scripts/experiment-odds-movement.ts`.

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
