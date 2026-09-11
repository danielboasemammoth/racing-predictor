# Prediction Architecture

How a prediction actually gets made and served, end to end, for the internal (Racing.com)
thoroughbred pipeline. Greyhound/harness racing is served by a separate, independent system (the
PuntersEdge paper-betting engine) - see the "Two separate systems" section at the bottom.

## Pipeline

```
Racing.com scrape (src/lib/scrapers/racing-com.ts)
  -> races / horses / race_entries tables (Supabase)
  -> feature engineering (src/lib/prediction-v3.ts: buildFeatures())
  -> per-config linear score -> softmax -> win/top3 probability (src/lib/prediction-v3.ts)
  -> multiple model configs run in parallel (src/lib/prediction-suite.ts)
  -> ensemble (average of two configs) = production Champion (v4.1-ensemble)
  -> predictions table (one immutable row per race/model_version/predicted_at)
  -> accuracy backtest, once the race completes (src/lib/backtest.ts, /api/admin/backtest)
  -> daily-picks.ts reads stored predictions + Reliability Score to build the home page shortlist
```

Nothing on this path re-trains or re-backtests during a normal page render (spec section 50) -
`/api/admin/predict` and `/api/admin/backtest` are explicit admin-triggered actions, and the home
page / accuracy page only ever read already-stored `predictions`/`accuracy_log` rows.

## Feature engineering (`buildFeatures()`, prediction-v3.ts)

13 features per runner, every one computed only from data that existed strictly before the
target race's `race_datetime` (`availableHistory = allHistory.filter(start => start.raceDatetime <
targetTime)` - see the Data Leakage section below):

`recentForm, contextualForm, distanceSuitability, conditionSuitability, courseSuitability,
classMovement, speedRating, jockeyForm, trainerForm, partnershipForm, barrierSuitability,
weightSuitability, fitness` (+ `historyStarts`, a count, not itself a model input).

Each feature is a 0-1 value, "centered" at 0.5 = neutral/no-data. `speedRating`'s weight is 0 in
every hand-tuned config (kept computed, not yet trusted enough to weight - see
`scripts/experiment-sectional-speed.ts`).

## Model configs (`MODEL_CONFIGS`, prediction-v3.ts)

| Version | Weights | Notes |
|---|---|---|
| `v4-baseline` | hand-tuned | original baseline |
| `v4-context-form` | hand-tuned | heavier on contextualForm |
| `v4-connections` | hand-tuned | heavier on jockey/trainer/partnership |
| `v4-optimized` | hand-tuned | near-identical to connections (historical copy-paste) |
| `v5-trained` | gradient-descent fitted | conditional-logit training, `scripts/train-logit-weights.ts` - a real but modest edge over hand-tuning (0.2672 vs 0.2654 validation objective) |
| `v4.1-ensemble` | n/a | **production Champion** - plain average of `v4-optimized` + `v4-connections` win/top3 probabilities |
| `v6-market-blend` | n/a | **Challenger** - see MODEL_PROMOTION.md |

None of these are a trained ML model in the conventional sense except `v5-trained` (and the new
research-only place classifier, see MODEL_RESEARCH.md) - the rest are hand-guessed linear weight
vectors run through the same scoring function. There is no `PredictionModel` interface
(train/predict/evaluate/serialize/load) - each script that needs to "train" something
(`train-logit-weights.ts`, `train-place-model.ts`, `feature-ablation.ts`) implements its own
self-contained gradient descent, matching this repo's existing "no shared abstraction for a
one-time operation" convention.

## Win probability -> Place probability

Win probability comes from `softmax(score)` across the field. Place (`top3_probability`) is
**derived from win probability only**, via Harville's (1973) formula
(`src/lib/betting/harville.ts`), using the race's actual TAB-payable place count
(`src/lib/betting/place-rules.ts::paidPlacesCount` - 3 places for 8+ horse/harness starters, 2 for
5-7, win-only below that; greyhounds always pay 2 for 5+ starters, handled separately in the
PuntersEdge system). A genuinely independent PLACE classifier was built and evaluated as a research
experiment (`scripts/train-place-model.ts`) - see MODEL_RESEARCH.md for the out-of-sample result
and whether it has been promoted.

## Data leakage audit (spec section 2)

Every one of the 13 features is derived exclusively from `availableHistory` (starts strictly
before the target race's `race_datetime`). None of them use: finishing position, margin, or
finishing time of the CURRENT race; post-race/closing prices; or any settled-race aggregate. The
only price data used anywhere is `race_entries.sectional_times.odds`, which is Racing.com's own
recorded quote feed at scrape time, and it is only used for *edge/ROI analysis after the fact*
(reliability-context.ts, roi-analysis.ts) and in the market-blend Challenger - never fed into the
win-probability model itself. This was independently re-verified while building
`scripts/walk-forward-backtest.ts` and `scripts/train-place-model.ts`.

## Confidence / Race predictability

`src/lib/reliability-score.ts`'s **Reliability Score** (0-100, `Poor`..`Exceptional`) functions as
this project's race-predictability score: inputs are the predicted winner's probability, its gap
over the second-favourite, and how many other base models agree - matched against a
tiered-relaxation historical comparable-cohort (never a raw arbitrary threshold), with hard vetoes
that prevent an unproven or thin-evidence cohort from ever claiming "Strong" or better. See
CALIBRATION.md for the full mechanics.

## NO PREDICTION support

`src/lib/daily-picks.ts`'s Reliability-based qualification gate can and does return **zero**
picks: a race only qualifies for that gate if a Reliability Score was computed, has no active
hard veto, and classifies at `Average` or above. There is no Top-N cap - `getDailyPicks(...,
limit)` only caps the DISPLAYED count, the gate itself is threshold-based, not count-based.
As of 2026-09-11, the home page's "Today's/Tomorrow's highest-conviction picks" section no
longer uses this Reliability gate by default - it uses a standalone
`minWinProbability`/`MIN_WIN_PROBABILITY_FOR_HIGH_CONVICTION` (0.35) filter instead
(`skipQualificationGate: true`), showing every qualifying race uncapped. The Reliability gate
itself is untouched and still selectable via the "Reliability >= 80" filter toggle/`minReliability`
option - both filters can be combined via `DailyPicksFilterOptions`.
A separate "Today's/Tomorrow's conservative picks" section (also uncapped) was restored the same
day, using the Reliability gate directly (no `skipQualificationGate`/`minWinProbability`) - the
home page now shows BOTH lists side by side (conservative shortlist AND high-conviction), each
independently uncapped.

## Two separate systems - do not conflate

This repo runs two independent prediction/decision systems:
1. **Internal (Racing.com) horse model** - described above. Feeds the home page, `/accuracy`,
   and the Conservative Shortlist.
2. **PuntersEdge paper-betting engine** (`src/lib/paper-betting/`, `src/lib/betting/`) - a
   market-consensus (+ optional fundamentals-hybrid) model covering horse, greyhound AND harness
   racing for simulated BET/WATCH/NO_BET decisions, entirely separate storage
   (`pe_races`/`pe_runners`/`pe_recommendations`/`paper_bets`). See
   `/memories/repo/puntersedge-api.md` and `/memories/repo/racing-predictor-notes.md` for its
   history - it already has its own Harville-derived place probability, maxOdds risk cap, drift
   detection, and settled-bet validation dashboard (`/paper-betting`).

Both systems independently derive PLACE from WIN via Harville; neither has an independently
trained place model in production as of this writing (see MODEL_RESEARCH.md).
