# Paper Betting Selection and Evidence

Internal automatic paper betting now checks WIN and PLACE independently:

- WIN: existing reliability shortlist score >=80, plus positive estimated value and at least a five-percentage-point edge.
- PLACE: every runner in the current prediction, not just the predicted winner; top-three probability >=60%, positive estimated value, and the same five-point edge floor.
- Both: recorded decimal odds above 1 and at most 15; upcoming race 1-180 minutes away; prediction field must match the current active starters.
- Internal PLACE requires at least eight active starters. Smaller fields are excluded because a top-three estimate is not a valid probability for a two-place market.
- Repeat runs use a stable race/runner/market key. Existing bets and account staking settings are preserved.

The 60% PLACE floor and existing edge threshold are provisional paper-testing rules, not a validated profitable strategy. Win Reliability Score is not a place probability. Recorded Racing.com prices are not guaranteed executable TAB prices. Hourly polling can miss odds that only arrive shortly before a race.

PuntersEdge continues to evaluate its own WIN and PLACE recommendations separately. The new internal path does not relax its price-freshness or confidence requirements.

## Performance

### Policy Tracking

Apply `supabase/migrate-paper-betting-policy.sql` in the Supabase SQL editor to enable prospective policy tags. It adds a nullable column and index without changing old records. Internal automatic bets then record `internal-value-v1`; model version and stable duplicate-prevention keys remain unchanged. Before migration, betting continues untagged and the scheduled-job response explicitly reports that tracking is unavailable. Never infer the policy of an untagged bet from its timestamp.

The validation page and read-only performance command separate policies by source, manual/automatic mode, model, and market. The latest internal run's counters are stored in `analysis_snapshots` under `paper-policy-latest-run`; the scheduled response also logs them. Rejection counts record the first failed gate per runner/market, not every possible failure. Races skipped before evaluation are counted separately. This is aggregate diagnostics, not a historical dataset of rejected selections or a counterfactual ROI backtest. No thresholds changed in this tracking milestone.

The paper-betting page separates WIN and PLACE outcomes, including the overlapping subsets whose recorded probability was >=60% and estimated value was positive. It reports bets, distinct races, predicted/actual hit rate, estimated ROI, and realised stake-weighted ROI. These cohorts include previous policies and manual bets; they are not a backtest of the new policy.

Run the read-only model/source breakdown:

```powershell
npx tsx --env-file=.env.local scripts/paper-betting-performance.ts
```

Only WON/LOST bets count. Pending and refunded bets are excluded. Multiple bets in one race are correlated. A high hit rate, positive model EV, or short profitable streak does not establish positive future ROI. Judge the new policy on subsequent settled bets, without repeatedly tuning to the same small sample.

## Live Review: 2026-09-15

The default account had 36 decided bets: 10 WIN (10.0% hit rate, -85.5% ROI) and 26 PLACE (19.2% hit rate, -1.0% ROI). Only two PLACE bets qualified for the >=60% chance/positive-EV historical subset (50.0% hit rate, -12.5% ROI). No profitable cohort is established. All 26 decided PLACE bets came from the PuntersEdge horse hybrid; internal automatic betting had previously placed WIN bets only. The three internal automatic WIN bets had a stake-weighted estimated ROI of -26.0%, motivating the new value gate.

The opportunity query also previously filtered on WIN decisions only, hiding PLACE-only selections. It now selects the latest runner snapshot before checking either market, and the page labels both opportunities and bet history by market.

The seven-model audit used the preceding seven days: 321 completed races, 187 with matching active fields and pre-race forecasts from every current model. Retrospective/late forecasts, missing fields, and dead-heat winners were excluded. Place Brier uses the 136 paired races with at least eight active starters. Brier is mean squared error per runner, averaged over races; lower Brier and log loss are better.

| Model | WIN Accuracy | WIN Brier | WIN Log Loss | Top-3 Brier |
| --- | ---: | ---: | ---: | ---: |
| v4-baseline | 22.5% | 0.10199 | 2.1447 | 0.20336 |
| v4-context-form | 23.5% | 0.10191 | 2.1441 | 0.20357 |
| v4-connections | 26.2% | 0.10158 | 2.1266 | 0.20152 |
| v4-optimized | 26.2% | 0.10142 | 2.1169 | 0.19999 |
| v5-trained | 23.5% | 0.10176 | 2.1054 | 0.19958 |
| v4.1-ensemble | 26.2% | 0.10149 | 2.1214 | 0.20069 |
| v6-market-blend | 28.3% | 0.09619 | 1.9383 | 0.20069 |

Keep v6 as the WIN champion. Its PLACE estimates intentionally remain the ensemble's estimates. The small v5 place-Brier advantage alone is insufficient for promotion: place log loss, chronological stability, and prospective ROI still need evaluation. No model weights were retuned on this sample. The corrected PuntersEdge probability normalization excludes scratched runners; regression tests confirm they no longer dilute the active field.

Reproduce the read-only model audit:

```powershell
npx tsx --env-file=.env.local scripts/audit-live-models.ts
```

## Chronological PLACE Study: 2026-09-15

Read-only command:

```powershell
npx tsx --env-file=.env.local scripts/evaluate-place-calibration.ts
```

The initial 30-day query found 1,382 completed races and retained 231 races over 12 Melbourne dates. Exclusions: 698 without a pre-race current-model forecast, 296 not paying three places, 133 with changed/mismatched fields, and 24 with incomplete/ambiguous results. The sample is selective; it does not cover all races or two-place markets.

The candidate is `corrected = (1-strength)*raw + strength*(3/fieldSize)`. Its single parameter minimizes race-weighted training Brier, constrained to [0,1]. No betting thresholds are tuned. A coherent full-field distribution still sums to three; therefore aggregate predicted-vs-actual hit rate across all runners is mechanically equal and is NOT evidence of calibration. Brier/log loss and probability-specific selection results are the relevant diagnostics.

- Training: 102 races, September 3-9; fitted strength `0.3345894804013903`.
- Validation: 33 races, September 10-11; Brier 0.19858 -> 0.19579, log loss 0.58604 -> 0.57838.
- Test: 96 races, September 12-14; Brier 0.20209 -> 0.19869, log loss 0.59540 -> 0.58552.
- Test value selections: raw 26 bets/25 races, corrected only 4 bets/3 races. Corrected hit rate was 75%, but this is far too small to infer reliable ROI. Recorded-price flat-stake returns are exploratory, not actual paper settlements or guaranteed executable prices.

The test partition was held out from fitting and opened only after the validation gate passed. These historical races had also appeared in earlier general model audits, so this is not a substitute for genuinely future validation. The rolling command is research, not an automatic retraining/promotion job; do not repeatedly tune against the same test outcomes.

Decision: freeze this candidate for prospective shadow observation, not production betting. No threshold, probability, or staking changes were applied. Its improvement in overall probability accuracy does not justify reducing live paper-bet volume based on three selected test races. PuntersEdge's 26 selected PLACE bets over 18 races come from a different hybrid and do not support transferring this correction or fitting their own credible train/validation/test split.

## Prospective Shadow Observation

Starting September 16 Melbourne time, the internal auto-bet run records the first eligible full-field forecast for each race under `place-shrinkage-shadow-v1`. The strength is frozen at `0.3345894804013903`, source model at `v6-market-blend`. This observer uses the existing `analysis_snapshots` table; no new migration is required for shadow capture. It runs only when the existing internal automatic-betting job runs, so activate the hourly schedule to improve coverage.

Capture requires an upcoming race 1-180 minutes away, at least eight active starters, a matching current forecast field, and a coherent distribution summing to three. It stores raw probabilities, corrected probabilities, source forecast time, capture time, and recorded prices without outcomes. Insert-on-conflict-do-nothing preserves the first capture. It never changes a prediction, recommendation, stake, or paper bet; capture errors are counted and do not block betting. Only the latest run-level diagnostics are replaced; race-level shadow snapshots remain immutable.

The public paper-betting page shows capture/pending/scored/excluded counts and paired results as they accumulate. The read-only evaluator is:

```powershell
npx tsx --env-file=.env.local scripts/evaluate-place-shadow.ts
```

Scoring uses completed race results and the captured prices, rejecting changed fields, ambiguous place results, mismatched candidate provenance, and forecasts captured after the actual start. Cancelled/missing races are excluded, not losses. This is a selective complete-field sample; report exclusions alongside results. Shadow ROI is a flat-stake diagnostic, not an executable-price or actual-wallet claim.

Review once at least 100 new races are scored for overall probability quality and 30 distinct races contain qualifying corrected value selections. These are minimum review checkpoints, not significance guarantees or an automatic promotion. Check paired Brier/log loss, stability across later race days, selection hit rates, correlated race exposure, and recorded-price limitations before changing production. Do not refit the candidate while this prospective check is running.