# Historical Simulator

`/paper-betting` is now a read-only, client-side historical simulator. The old betting account and records are preserved at `/paper-betting/archive`; placement, account mutation, regeneration and the old server-side what-if endpoint return HTTP 410. Automatic placement is disabled at both producers and the shared repository. Odds ingestion, PLACE research-shadow capture and settlement of existing pending bets remain enabled.

## Setup After Database Recovery

1. Apply [supabase/migrate-historical-simulator.sql](supabase/migrate-historical-simulator.sql) using the Supabase SQL editor. It adds bounded service-role reporting functions, a job lease table, a completed-race index and the public `racing-reports` Storage bucket. It does not delete or rewrite race, prediction, result or betting history. Schedule index creation during low traffic because ordinary index creation can temporarily block writes.
2. Build the app, then publish the initial report from the project root:

```powershell
npm run build
npx tsx --env-file=.env.local scripts/refresh-simulation-report.ts
```

The command requires the existing Supabase URL and service-role environment variables. Keep credentials out of the browser. Offline SQL tests do not establish production query performance; measure healthy refreshes before increasing load. A missing migration is reported as a skipped scheduled refresh and does not block the live pipeline.

The manual CLI has a ten-minute overall budget for first publication or a pricing-version rebuild. The scheduled HTTP endpoint retains its 200-second work budget, individual reads retain their 30-second timeout, and all publishers use the same 15-minute lease.

Activation verified September 26, 2026: the user applied the migration, and the first report was published at 12:10 UTC with 1,000 races, seven current models and 20 chunks. Public Storage readback validated every chunk; 975 races had eligible pre-race forecasts. Earlier attempts correctly withheld publication on source changes, and one encountered PostgreSQL `57014`; this successful publication does not establish sustained database capacity. CLI errors now identify the failing stage and preserve the database error code. No racing or betting history was altered by report publication.

## Simulation Rules

### Saved Strategies And Presets (October 1)

Named **Save settings** snapshots are separate from the auto-saved working draft. Load, delete and JSON export are available; replacing an existing name requires confirmation. Profiles stay in this browser under `racing-saved-strategies-v1`. JSON export moves a profile between local origins/devices without uploading it. `/real-betting` explicitly applies a copy as a disabled draft, never follows subsequent paper-page edits, and never receives TAB credentials.

The History button beside each Reset applies the **legacy internal policy**, using the same constants as the retired producer: production-model WIN rank 1, reliability >=80 and verified non-vetoed qualification; PLACE >=60% across the complete field, at least eight starters; both edge >=5 points, odds <=15, and 1-180 minutes before jump. Added controls include inclusive probability/edge floors, $15 odds cap, a distinct minimum-field setting, runner scope, qualification evidence, and capture-time window. Existing strict defaults and retired `minField` preferences remain unchanged.

This is not a reconstruction of actual eligible bets. Old reliability/veto decisions were not frozen and remain excluded. Future hourly observer runs freeze the first valid pre-race evaluation per prediction under `analysis_snapshots.kind = simulator-evidence-v1:<prediction-id>` without placing bets. Reports accept only matching runner/forecast IDs and timestamps after forecast creation but before race start. Time windows use this frozen evaluation where available, otherwise recorded TAB capture times, never invented placement times. The separate PuntersEdge consensus/hybrid policy uses confidence, feature completeness and different model probabilities absent from this report; internal probabilities are not substitutes. Full-field PLACE and evidence loading require rerunning the updated, idempotent historical simulator migration and publishing a new report. Old top-three-only chunks fail closed for full-field mode. Current-field and final-field identity remain distinct live requirements for a future executor.

The Trending Up button searches historical net profit over a bounded grid: each model, edge -10/-5/0/5/10, probability floor 0/50/60/70, odds cap 3/5/10/15, and any top-three runner or rank 1, at current staking. It chooses one winner on the older 70% of Melbourne racing days, requiring 30 selected training races, then evaluates that fixed winner on the newest 30%, requiring 15 selected races and positive profit. Settings stay unchanged if those checks fail. At least six days and 45 total races are required. Displayed profit is historical, not predicted future profit. Separate model bankrolls are not a combined live portfolio.

Suggestions recompute when the report refreshes (checked every 15 minutes), race window or staking changes. Legacy defaults track maintained policy constants, not automatic threshold tuning. Neither kind silently changes saved strategies or real-betting drafts. Repeated research can still overfit; a rolling holdout is not a permanently untouched prospective trial.

Useful next controls: maximum combined exposure per race; daily loss stop and cooldown; allowed jurisdictions/race types; acceptable price slippage and quote age; per-strategy prospective shadow results; and provider rejection/reconciliation alerts. Real-money execution requires these protections and a verified live selection/quote pipeline, not just a profitable backtest.

### Replay

- Select the latest 100, 250, 500 (default) or 1,000 completed races, then filter each market independently. The window is selected before filters; missing forecasts never cause older races to be substituted.
- Use the latest eligible pre-race prediction for each current model, with its top three runners and recorded WIN/PLACE prices. Both the prediction timestamp and insertion timestamp must precede race time. Retrospective forecasts are excluded.
- Both markets default to strictly greater than 50% top-three probability and positive model edge. Edge is model market probability minus raw implied probability (`1 / decimal odds`), in percentage points. WIN uses win probability; PLACE uses top-three probability only where three-place settlement is supported.
- Filters include model, rank, reliability, win/top-three probability, implied probability range, edge, price range/source, venue and field size. Historical reliability is unavailable because it was not frozen before these races; selecting a minimum reliability excludes unknown values instead of reconstructing scores using future results.
- Field-size filters are strict upper limits: `< 8 starters` includes seven or fewer, while `Any` applies no size limit. WIN and PLACE limits are independent. Old saved minimum-field limits reset to `Any` without changing other preferences. PLACE settlement exclusions still apply regardless of the selected filter.
- WIN/PLACE filters, race count, bankroll/staking controls and result sort order are remembered in this browser's local storage under `paper-betting:simulator-preferences:v1`. Each market's reset button also saves its defaults. Settings are not sent to the server or shared across devices; clearing site storage removes them. Invalid saved fields fall back to defaults, and blocked storage does not prevent simulation.
- Each model gets its own starting bankroll. Flat-dollar, bankroll-percentage and fractional Kelly staking are available. Bets in the same race share available cash proportionally if necessary; stakes cannot exceed available funds. Following user approval on September 28, races settle before the next race is replayed. This is a race-sequence backtest, not a reconstruction of real-time liquidity: database ingestion delays and overlapping races do not reserve funds. Equal-start races use stable race-ID order. Monetary totals are accumulated in integer cents.
- Dead heats, incomplete or ambiguous outcomes, missing odds and changed fields with unverified deductions are excluded. Scratches are refunded where a recorded price exists. PLACE requires at least eight unchanged active starters and complete top-three results. These are recorded-price simulations, not guaranteed executable TAB returns or audited bookmaker settlements.
- ROI is net profit divided by total stake over all filtered WON/LOST rows, never just the displayed page. Refunds, excluded rows and unfunded bets are reported separately. Excluded rows are hidden from the table and CSV; their counts remain visible. Changed-field/deduction uncertainty and two-place probability mismatches cannot be repaired by merely rerunning tasks. Corrected source results can resolve incomplete-result exclusions; existing predictions are never rewritten. Filtering historical results is exploratory and is not evidence of future profitability.

## TAB Quote Timing

Simulator prices are enriched from retained `pe_odds_snapshots`, independently of the frozen pre-race forecast. Only an unambiguous venue/race-number match within five minutes and an unambiguous normalized runner-name match are accepted. The latest eligible TAB snapshot must be captured no later than scheduled race time, have a known quote age of at most 120 seconds, and imply a quote timestamp within the final ten minutes before scheduled start. Quote time is estimated from capture time minus the provider-reported age. CSV includes quote and capture timestamps.

Post-start snapshots are not assumed to be official closed-market prices because the retained records do not prove the market was closed. Older TAB prices embedded in predictions have no quote timestamp and are no longer accepted for simulation. Racing.com prices remain separately labelled; they are not relabelled as TAB. These checks also apply when the browser reads an old report. Hourly polling cannot guarantee near-start coverage for every race; missing quotes remain missing rather than using an early price or inventing a closing price.

September 28 validation: a bounded live lookup found qualifying near-start quotes for one of ten previously TAB-priced races (ten runner quotes). The first pricing-version rebuild then failed at `Reading race window` with PostgreSQL `57014`, before loading quote batches. The previous report was retained. A successful rebuild is still required after database recovery; local tests and that limited lookup do not establish full historical price coverage.

## Reporting And Database Load

The hourly job fingerprints at most 1,000 completed races. Changed races and races in the last 24 hours reload forecasts in sequential batches of ten; recent races are rechecked for qualifying quotes. Version 3 includes full-field selections and requires rerunning the updated historical simulator SQL; a fingerprint salt forces old chunks to rebuild after that SQL is applied. TAB snapshot reads are paginated in bounded batches and use existing tables and indexes. Older unchanged reports cause no payload reloads or storage writes. A database lease prevents overlapping report publishers; a source-window recheck prevents publication across source changes.

Reports are published as content-addressed JSON chunks of at most 25 races, followed by a manifest switch only after every chunk succeeds. The previous manifest remains intact on failure. Chunks contain public racing data only, never accounts or private betting history. Browsers fetch Storage/CDN objects with at most three concurrent chunk reads, check for a new manifest every 15 minutes, and perform filtering, staking, sorting and pagination locally. A loaded report survives a refresh failure; a cold browser still needs Storage availability. This is not a guaranteed offline download or a separate-provider outage mirror.

Old immutable chunks are currently retained, so monitor bucket growth. A future retention job must retain all chunks referenced by current manifests and allow a grace period for in-flight readers; do not delete original racing or prediction history to reclaim reporting space. The hourly scheduler and six-AM maintenance split are described in [SCHEDULED_TASKS.md](SCHEDULED_TASKS.md).

## Verification

Run `npm test`, `npm run lint`, `npm run build` and `./scripts/windows/test-daily-pipeline.ps1`. SQL regression tests use an isolated PGlite database; they do not connect to Supabase.

With a local app running, `npx tsx scripts/verify-historical-simulator.ts http://localhost:3022` runs the Playwright UI check using installed Microsoft Edge. It intercepts clearly labelled report fixtures, blocks external/API requests and navigation prefetches, and verifies defaults, bankroll calculations, filtering without additional fetches, pagination-independent ROI, all-row CSV export, desktop/mobile overflow and report failure states. Screenshots are written to the ignored `scripts/output` directory. No fixture data is published to Storage or the database.

## Archived Policy And Evidence

The following sections describe the retired paper-betting system and historical reviews, not the simulator's current defaults or active placement policy.

### Former Selection Rules

Internal automatic paper betting previously checked WIN and PLACE independently:

- WIN: existing reliability shortlist score >=80, plus positive estimated value and at least a five-percentage-point edge.
- PLACE: every runner in the current prediction, not just the predicted winner; top-three probability >=60%, positive estimated value, and the same five-point edge floor.
- Both: recorded decimal odds above 1 and at most 15; upcoming race 1-180 minutes away; prediction field must match the current active starters.
- Internal PLACE requires at least eight active starters. Smaller fields are excluded because a top-three estimate is not a valid probability for a two-place market.
- Repeat runs use a stable race/runner/market key. Existing bets and account staking settings are preserved.

The 60% PLACE floor and existing edge threshold are provisional paper-testing rules, not a validated profitable strategy. Win Reliability Score is not a place probability. Recorded Racing.com prices are not guaranteed executable TAB prices. Hourly polling can miss odds that only arrive shortly before a race.

PuntersEdge continues to evaluate its own WIN and PLACE recommendations separately. The new internal path does not relax its price-freshness or confidence requirements.

## Performance

### Page Availability

Wallet, opportunities, validation, and shadow queries have independent error states. A PostgreSQL statement timeout (`57014`) in one section no longer aborts the entire page. Failed loads display "temporarily unavailable", not zero balances, missing accounts, or an empty opportunity set. Server logs identify the section and error code without dumping upstream payloads.

The opportunity reader first selects upcoming race IDs, then loads recent snapshots in batches of at most 20 races with at most four concurrent queries. It uses the existing recommendation race-ID index and retains latest-snapshot-before-decision filtering, including PLACE-only candidates. No new migration or increased database timeout is required.

For read-only query timings with the same public access as the page:

```powershell
npx tsx --env-file=.env.local scripts/diagnose-paper-page.ts
```

This probes the wallet account/bets queries and the opportunity, validation, and shadow loaders. It does not include wallet race-label lookups or reproduce production load; successful timings do not prove a previously reported timeout cannot recur.

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