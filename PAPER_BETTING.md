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