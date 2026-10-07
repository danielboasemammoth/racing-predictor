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

Version 3 activation verified October 1, 2026: the updated migration was applied, including the valid prediction-creation index and full-field/evidence source function. A live refresh rebuilt all 1,000 races into 40 chunks and published at `2026-10-01T03:47:54.228Z`; the application's public report loader read and validated every chunk. This recovered the previously failing race-window query (`57014`). The 13:00 Melbourne scheduled run also confirmed that a report failure no longer prevents odds sync, pruning or page publication. Sustained unattended report refreshes still need observation; missing historical qualification evidence is not backfilled.

Unattended recovery verified later October 1: the 14:00 and 15:00 Melbourne DailySync runs both published simulator reports, completed all steps, and refreshed home/opportunities/results snapshots. Windows reported `LastTaskResult = 0` for the 15:00 run and the next trigger at 16:00. The public report generated at `2026-10-01T05:11:29.797Z` passed the application loader's validation of all 1,000 races and 40 chunks. These two successful unattended runs establish recovery, not a guarantee against future provider outages.

### Evidence And Preset Assessment

```powershell
npx tsx --env-file=.env.local scripts/assess-betting-readiness.ts --app-url=http://localhost:3030 --since=2026-10-01T03:47:54.228Z --capture-evidence
```

Omit `--capture-evidence` for a read-only assessment. The capture option calls the existing retired-betting observer, verifies zero bets and capture errors, and checks existing evidence was not changed. The script validates evidence timestamps against prediction creation and race start, then writes a timestamped JSON research snapshot under `scripts/output/`. It uses the default $500 bankroll per model and $10 flat stakes, not any saved user strategy. New-result metrics include only races starting after `--since` that are also outside the optimizer's older-day training period.

October 1 assessment at 15:30 Melbourne:

- One additional qualification snapshot and one PLACE shadow race were captured with zero errors and no bets. There are 68 qualification snapshots across 35 distinct races, including five qualified snapshots and 11 completed races. All 67 existing snapshots were unchanged; all linked pre-race timestamp checks passed. Forty-six snapshots were captured after the activation cutoff. Snapshots are per prediction and must not be counted as independent race observations.
- The current report contains eight completed races starting after the activation cutoff. Each market searched 1,120 configurations; training days precede September 25, with later days reserved for holdout. Both training winners passed the existing holdout gate.
- WIN winner: `v6-market-blend`, any top-three rank, strict edge >0 points, odds <=15, no probability or reliability floor. Training: +$486 across 106 selected races. Holdout: +$251.50 across 74. New-result subset: 14 bets across five selected races, four wins, $140 staked, +$86 simulated profit.
- PLACE winner: `v6-market-blend`, any top-three rank, strict edge >-10 points, odds <=10, no probability or reliability floor. Training: +$949 across 120 selected races. Holdout: +$501.70 across 90. New-result subset: 10 bets across four selected races, seven wins, $100 staked, +$154 simulated profit.
- The legacy internal WIN preset selected no new bets; legacy PLACE selected one winning bet (+$11 at $10 stake). Missing historical WIN evidence remains excluded.

These are recorded-price simulations with separate bankrolls, not real returns or an executable TAB-price guarantee. The new subset is outside training but is part of the holdout used for eligibility; it is not a prospectively frozen, untouched trading trial. Four or five selected races are far too few to establish profitability. The exact filters and report timestamp are retained for later comparison; no saved settings, drafts, schedules or live strategies were activated or changed.

## TAB PLACE Research (October 6, 2026)

The simulator now supports independent minimum/maximum TAB WIN-market ranks and one highest-estimated-value pick per race, model and market. These are market ranks, not forecast ranks. Joint favourites all have rank 1; ties use competition ranking. Rank filtering requires a complete unchanged field with valid TAB WIN prices from one capture timestamp, each meeting the existing freshness rule. Missing or mixed-time evidence is excluded. One-pick ties use stable bet IDs, never outcomes. These settings persist in working drafts and saved profiles; existing defaults remain unchanged. Exact seven/eight-runner windows use minimum 7/8 and exclusive maximum 8/9.

The separate prospective comparison freezes `tab-place-value-v1` onto new production-model decision observations, retaining the existing first-valid-quote rule. It compares favourite, ranks 2-4 and outsiders (5+) separately for seven and eight starters. Each cohort uses its own $500 simulated bankroll, $1 flat stakes, one highest-value selection per race, raw `v6-market-blend` probabilities, edge >=5 percentage points, estimated return >=5%, and decimal odds <=15. These are fixed research rules, not a fitted or profitable strategy. Older untagged decisions are not retrospectively enrolled. A future calibrated candidate requires a new frozen version.

Strict eligibility requires verified pre-race TAB fixed-place terms, two paid places for the seven-runner arm and three for the eight-runner arm, a matching unchanged field, fresh frozen prices, complete results and coherent probabilities. Top-two probability uses Harville on the complete frozen WIN distribution; this is an estimate, not empirically calibrated probability. Third place loses on verified two-place terms. Legacy unverified seven-runner PLACE rows remain excluded.

**Current capture blocker:** the official [PuntersEdge OpenAPI](https://api.puntersedge.online/openapi.json), checked October 6, documents race-level `places_paid` as the supplying bookmaker's count. It does not identify that bookmaker as TAB or provide TAB-specific term observation timestamps. Stored raw payloads do contain this field, but it is not sufficient to label TAB terms verified. Race-level `stale` and `data_age_seconds` describe the oldest bookmaker quote, not specifically the age of the terms. The new optional `TabPrice.placeTerms` contract is deliberately not populated by the current feed adapter. No historical terms are backfilled from mutable `pe_races.last_raw_payload`, field size, or eventual dividends. The strict trial and TAB calibration therefore remain blocked until an approved, attributable pre-race terms source is integrated. No direct TAB wagering connection was added.

The comparison reports stake, profit, ROI, distinct selected races, observed/expected hit rates, drawdown, losing days, worst day, longest losing streak, Brier/log loss and descriptive Wilson hit-rate intervals. Review needs at least 300 selected races across 30 betting days per cohort; this is a review gate, not a significance claim or automatic promotion. Results cover only the selected completed-race report window, not a lifetime ledger, so retain dated CSV exports for longer-term evaluation. No increased stakes, chasing losses or live promotion is enabled.

TAB-specific calibration is separated by paid-place count and requires 150 verified races across at least five Melbourne days before fitting. Whole days split chronologically 60/20/20; shrinkage is fitted only on training data, validation must improve Brier and log loss with at least 30 races per training/validation split, and the test remains withheld on failure. A passing test still needs at least 30 test races and separate prospective review. No real eligible calibration sample or profitable calibrated strategy has been established. Existing report version 4 remains readable; new decision metadata flows through ordinary refreshes, without rewriting old observations or forcing a historical rebuild.

## Simulation Rules

### Today's TAB Tote Batch

The **Today's TAB Tote batch** panel on `/paper-betting` generates a read-only text preview from the currently loaded configuration, including shared saved strategies. Choose the jurisdiction of your TAB account (VIC, NSW or QLD), select **Generate batch**, review the runners and combined stake, then use **Copy TAB batch text**. Nothing is sent to a TAB account; submission and confirmation remain manual in TAB's own interface.

The linked [TAB batch interface](https://help.tab.com.au/betting-on-racing/batch-betting-through-tab) supports **Tote**, not fixed-odds orders. The user explicitly approved Tote export. Its [format guide](https://www.tab.com.au/info/batch-betting) specifies `SR-01-WP-00005.0-00000.0/1/` for a $5 WIN bet. Export uses current jurisdiction-specific `sellCode.meetingCode` plus race type from TAB's daily schedule, not the venue mnemonic, a static code table or a barrier number. Each WIN or PLACE line has one runner and separate five-digit/one-decimal stake fields, no spaces, CRLF line breaks, and no more than 8,000 lines. Stakes must be positive multiples of $0.10, within the format's limit; unsupported amounts are rejected, never rounded silently. TAB's own minimum stakes and final acceptance still apply.

Selection uses the shared simulator filters against full upcoming forecasts, not completed-race outcomes. Only races still upcoming on today's Melbourne date qualify. Latest forecasts, frozen decision observations and original archived History picks remain separate. Exact History ignores additional selection filters as in the simulator, but uses only previously archived upcoming selections and their original prediction IDs; no recovered or current replacement pick is invented. Missing original forecasts or archives are reported as coverage gaps. Custom price-based filters use recorded fixed-odds references under the existing source/timing rules, not unknown Tote dividends; custom TAB-only configurations still require their eligible reference quote. Exact History flat-stake Tote export does not require a historical fixed-odds quote, even when TAB-only settlement is selected: it exports the retained horse and stake, with the final Tote dividend unknown. Historical TAB settlement itself still excludes missing quotes. Fixed-odds profit/ROI is not a forecast of the exported Tote returns.

Fresh public TAB race details verify the date, meeting, race number, start time, open Tote pool and uniquely matched runner name/number. Closed, scratched, ambiguous, unmatched and unsupported selections are withheld. Custom latest/History and decision configurations require a complete current field; exact archived picks can survive other runners' scratches. PLACE needs the existing supported field/paid-place probability conditions. The preview explicitly reports withheld selections and coverage warnings. Source failures clear the batch rather than serving an old export.

**Flat stakes only.** Percentage staking requires an actual available account balance and Kelly requires a known dividend, so both are blocked rather than translated. The configured starting bankroll is a conservative ceiling on the combined batch, not a fetched TAB balance and not a separate allowance per model. Future winnings never fund the batch. Multiple models selecting the same runner/market block generation until a single-model configuration is chosen; no duplicate stake is silently added or removed. WIN and PLACE remain independent lines at their configured flat stake.

Preview validity is capped at two minutes from the start of source checks and at the earliest listed race start. Changing the configuration or jurisdiction immediately hides the old text and disables Copy. Expiry also hides the text; it cannot invalidate text already copied outside the app. Review TAB's validation, meeting codes, scratchings and total cost before confirming. Repeated submission can create duplicate real bets. No account credentials, balance reads, database writes, automatic wagering, new schedules or SQL migration are introduced.

Read-only endpoint: `POST /api/paper-betting/tab-batch` with canonical simulator `preferences` and `jurisdiction`, returning `Cache-Control: no-store`. Tests cover documented syntax, original archive retention, runner identity/status, flat staking, total exposure, duplicate prevention and validation failures. `npx tsx scripts/verify-historical-simulator.ts http://localhost:3038 --tab-batch` verifies generation, clipboard, configuration/jurisdiction changes, expiry, source failure and desktop/mobile layouts using isolated fixtures; it never submits bets.

### TAB Settlement Prices

Each market has an independent **settlement odds** selector: **Recorded prices** (the existing default) or **TAB only (no fallback)**. The TAB option recalculates settlement odds, implied probability, edge, Kelly stakes, returns, net profit and stake-weighted ROI using that market's eligible TAB quote. It persists in local preferences and shared saved strategies without changing older saved configurations. Exact History selection filters remain disabled, but the settlement selector stays available.

New home-shortlist archive generations store each selected horse's available TAB WIN/PLACE prices, estimated quote timestamp, capture timestamp and availability status in the existing `analysis_snapshots` JSON. Reads use the already-ingested odds tables, in batches of at most 20 races. The quote must have been captured by the archived selection time, have a known age, and be at most two minutes old at selection. Early selections are supported without the decision observer's 180-minute limit. Missing quotes and lookup failures are explicitly recorded; a lookup failure does not discard the pick. Insert-only generations and first-pick history retention prevent a later quote from replacing the original observation.

History modes use only this selection-time quote. Latest candidates use verified near-start quotes; frozen decision candidates use their own decision-time quote. TAB WIN, TAB PLACE and quote-timing columns appear in both table views independently of the selected settlement mode, with the same provenance in CSV. No Racing.com price or later TAB observation is substituted when TAB settlement is selected. Older History picks with no saved selection-time quote remain unpriced, even if a later quote exists. Raw quote pruning cannot remove prices already frozen in an archive.

TAB ROI covers only the priced, funded, settled subset, not every retained pick. Missing-price exclusions remain visible for exact History and TAB-only settlement; excluded rows have no stake/profit and ROI is unavailable when nothing settles. Refunds and post-selection field-change estimates retain the existing rules below. TAB quotes are observations, not accepted bets or audited payouts. Unknown scratching deductions remain unadjusted; legacy PLACE still assumes three paid places for unchanged fields of eight or more, and unsupported terms remain excluded. These calculations do not prove achievable or future profitability.

No SQL migration is needed for these JSON fields. Deploy the application so future publications capture quotes, then publish report pricing version 6 to carry the new fields into completed-race reports. This rebuild also includes the outright-WIN dead-heat correction below. It does not fabricate quotes for old selections or modify original predictions. Existing reports remain readable.

### Post-Selection Field Changes

In **Picks History - exact selections / selection time**, a bet is retained after other runners are scratched. Known WIN outcomes remain WON or LOST; a scratched selection is REFUNDED, including flat/percentage stakes with no saved price. Kelly still needs a saved price to determine the original stake. Other replay modes retain their existing conservative field checks.

Winning returns use the original saved odds before unknown scratching deductions and carry a payout-uncertainty warning in the table and CSV. Aggregate profit, ROI, bankroll and any subsequent bankroll-based stakes are therefore unadjusted estimates, not verified settlements. Losses remain full-stake losses and refunds return the stake. No replacement odds or deduction percentages are invented. Missing prices/results and unavailable PLACE terms still prevent reliable settlement; the selected runner's recorded finish is shown separately from bet settlement.

Report version 6 also stops a dead heat for a lower finishing position from invalidating an outright WIN. PLACE dead-heat handling remains conservative. The version change rebuilds old report rows on the next successful publication.

### Past Picks And Candidate Inspection

The independent **WIN forecast** and **PLACE forecast** selectors now include **Same earlier forecast as History**. The default remains latest/TAB decision. History mode uses only the horses retained by the published Past Picks snapshot, their exact original prediction IDs, and the WIN/top-three probabilities shown there. It does not select all runners from that earlier forecast or search for the most profitable historical timestamp. Forecast choice is retained in working drafts and saved profiles.

History prices come from that original prediction's recorded WIN/PLACE quotes, with their original provider labels. Later TAB near-start or decision-time prices are not substituted. Timestamp-free TAB prices embedded in old predictions remain unverified and excluded; selecting TAB-only odds can therefore produce zero History bets. This is a recorded-price historical simulation, not proof of an executable TAB offer. All other filters and staking rules still apply, including missing qualification/reliability, changed fields, unsupported PLACE terms, missing results and dead heats. Both losing and winning retained picks are replayed.

The scheduled report publisher reads the existing History page snapshot and retrieves original predictions by ID in batches of at most ten. No new live page queries, historical scan, schema migration or full-report pricing rebuild is required. A changed History snapshot invalidates affected report races even when race fingerprints have not changed. The page reports the snapshot timestamp and replayable/retained pick counts; missing original forecasts are not replaced. Coverage is limited to that History snapshot and the published simulator race window. CSV exports include forecast basis, prediction ID, History provenance and first-saved timestamp. Recovered forecasts remain distinct from verified archived home picks.

Past Picks is a prediction history, not a betting ledger. It retains the first archived home-shortlist appearance, or the first qualifying pre-race forecast for older uncovered dates (explicitly labelled recovered). The simulator instead uses the latest eligible pre-race forecast per model, or a separate frozen TAB decision when that source is selected. A historical winner can therefore have different probabilities here and fail the selected edge, probability, source or evidence requirements.

Each history card links to the matching race/horse in the simulator's **All candidates** view. This read-only view includes filtered-out candidates and evidence exclusions across the entire published report, with forecast timestamps and reasons from the same predicates that select simulated bets. Horse/venue search and Melbourne-date filtering affect only the table. Races outside the chosen strategy window are labelled; races outside the published report are reported as unavailable, never reconstructed with substitute odds. One-pick-per-race omissions are distinguished from filter failures. Winners, losers and ambiguous results remain inspectable.

The default **Simulated bets** view, saved strategy settings, portfolio totals and filtered-bet CSV remain unchanged. Inspection does not replay the original history forecast, relax eligibility, place bets or add excluded winners to profit. Source labels still distinguish Racing.com, TAB near-start and TAB decision-time prices.

October 6 diagnosis of Monday October 5: all eight recovered history picks were present within the newest 100 report races. All eight latest production-model WIN candidates failed the default positive-edge requirement; some also failed the top-three probability floor. Vantaa changed from 63.49% WIN in the retained history forecast to 40.54% in the latest forecast, versus 47.62% break-even at the recorded Racing.com price of $2.10. Mainstay additionally had ambiguous/dead-heat result evidence. Six winners and two losses in the history are not proof of six eligible TAB bets or realised betting profit.

Read-only comparison, using the current production model and public report (omit `--date` for the latest history day):

```powershell
npx tsx --env-file=.env.local scripts/diagnose-picks-history.ts --compare-simulator --date=2026-10-05 --verify-history
```

### Racing.com Provider Attribution

The simulator table and CSV include an `Odds provider` field. New predictions retain the exact provider code separately for WIN and PLACE alongside the selected price. Racing.com prices have always been the maximum recorded quote per market across the feed, not prices from a single bookmaker; ties now retain the first matching provider. This change does not alter odds, probabilities, filters or returns.

Provider names were verified on October 1, 2026 against Racing.com's public `https://www.racing.com/form/config.js?v=4550`, `siteConfig.WageringProviders`: `SB2` = Sportsbet, `LB2` = Ladbrokes, `PB3` = PointsBet, `BT` = bet365. Product codes retain the site's labels: `BTOTE` = Sportsbet BT+ WIN, `BTOTESP_LB2` = Ladbrokes BTSP, `BTOTESP_PB3` = PointsBet BT+SP, `BTOTESP_BT` = bet365 TOTE WIN. Displayed names include the original code. Unverified codes, including `BTOTESP`, `N`, `Q`, `V` and `OP`, remain explicitly unmapped rather than guessed. The mapping is local; rendering never contacts a bookmaker.

Older prediction snapshots discarded provider metadata and therefore show `Provider not recorded`. Attribution is not reconstructed from present-day race-entry quotes or matched by price after the result. Near-start and decision-time TAB overrides always display TAB and cannot inherit a Racing.com provider. Newly captured prediction metadata flows through ordinary report refreshes; no migration, historical rewrite or report pricing-version change is required. Best-of-feed/tote-product observations are not guaranteed executable fixed odds, so higher simulated profit is not evidence that one provider offers those returns.

### TAB At Decision Time

The odds-source selector now separates `TAB at decision time` (`tab_decision`) from `TAB near-start` (`tab`). The default latest-forecast/near-start view is unchanged and never adds decision observations as duplicate bets. Saved profiles, real-betting draft exports and CSV retain the selected source; decision CSV rows include the observation, quote and capture timestamps.

The observer freezes the **first valid quote observation per race/model** within 1-180 minutes before scheduled start, currently for the production model selected by the internal picks reader. It stores the exact forecast, its database creation timestamp, active field, qualification evidence and available runner quotes under `analysis_snapshots.kind = simulator-decision-v1:<race-id>:<model>`. Insert-only conflict handling prevents later forecasts, better prices or changed qualification from overwriting that observation. This is a fixed observation rule, not the first time an arbitrary saved strategy later qualifies; filters evaluate that frozen observation and never scan forward for a more favorable price.

Quotes come from existing TAB fixed-odds observations supplied through the odds feed, not a direct TAB wagering API. Matching requires an unambiguous venue/race/time and runner name. A quote must already have been captured by the decision and be no more than two minutes old at that decision, using reported quote age. Missing/unknown-age/stale quotes are excluded. Runner prices may have slightly different capture times within that freshness bound; this does not establish a simultaneously executable full-field offer. No credentials or provider orders are involved.

The hourly pipeline and standalone poll observe after odds sync. Existing hourly triggers are unchanged, so short-lived offers between polls can still be missed. The snapshot persists after raw quote pruning. Report version 4 loads it independently of the latest pre-race prediction, validates forecast creation and quote provenance, and conservatively excludes changed fields/start times or unsupported PLACE settlement. No historical snapshots are backfilled and no missing price falls back to near-start or Racing.com. Old races without observations have no decision-time rows; the UI shows coverage explicitly.

Activation October 1, 2026: a live poll captured 16 production-model decisions covering 160 runner quotes, with zero capture errors and no bets; all stored quote timestamps passed readback validation. Version 4 rebuilt and published all 1,000 races/40 chunks at `2026-10-01T05:56:16.073Z`. None of the newly observed races was yet in the completed report. Development and production browser checks verified source isolation, timestamped CSV, Save/Load and disabled-runner export across desktop/mobile. No schema migration was needed. Future real execution must obtain a fresh executable quote, recheck eligibility/stake and store TAB's accepted odds; these research observations do not guarantee acceptance.

### Saved Strategies And Presets (October 7)

Apply [supabase/migrate-betting-strategies.sql](supabase/migrate-betting-strategies.sql) in the Supabase SQL editor before using shared saves. It creates `public.betting_strategies`, keyed by strategy name, with JSON preferences and a saved timestamp. Reads are public; inserts, updates and deletes require the service role behind the existing admin-session API checks. Configurations are shared application-wide, not private per-user records. Do not store credentials in configuration names. No existing racing or betting data is modified.

Named **Save settings** snapshots now use that table, so every device using the same database can load them. Saving or deleting requires admin login; replacing an existing name requires confirmation. JSON export remains optional. The auto-saved working draft remains browser-local until explicitly saved. Old browser-only profiles remain available in **Legacy browser strategy**: load one and use **Save settings** after logging in to migrate it. They are not deleted or uploaded automatically. `/real-betting` reads the shared list and explicitly applies a copy as a disabled local draft; it never follows later changes or activates a runner.

**Picks History preset** loads a WIN-only, $10 flat-stake configuration with a $500 bankroll per model and the full 1,000-race report window. WIN and PLACE forecast selectors also offer **Picks History - exact selections / selection time** independently. This mode selects every retained History horse available in the report, ignores additional selection filters (disabled in the UI), and never replaces the retained forecast with a later selection or TAB quote. Enable PLACE explicitly to replay the same horses in that market; unsupported place terms remain excluded.

Placement uses `historyObservedAt`: the first archived shortlist observation for recorded picks, or the retained pre-race timestamp for recovered forecasts. Recovered timing is not proof of an actual home publication. Original recorded forecast prices are not proof of executable odds at that later observation. Cash is reserved at placement and returned only at the recorded settlement timestamp; missing/invalid settlement timestamps release no money for subsequent bets. Concurrent selections share available cash, so insufficient funds can produce reduced or unfunded stakes. Existing latest/custom History modes retain their race-by-race accounting unless combined with an enabled exact mode.

Exact-mode missing-data exclusions remain in the table and CSV, with zero stake and explicit reasons; CSV includes simulated placement time and payout uncertainty. Later field changes do not exclude already-selected bets: winning returns use unadjusted saved odds, losses lose their stake, and scratched selections are refunded. Missing original forecasts, prices, ambiguous results and unavailable PLACE terms are not fabricated. Coverage is limited to the retained History snapshot within the published report, whose counts and timestamp are shown. This remains historical replay only: it does not reactivate automatic paper placement or real betting. The preset is built into the app and works even before the saved-config table is installed.

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
- Dead heats, incomplete or ambiguous outcomes, missing odds and changed fields with unverified deductions are excluded. Scratches are refunded where a recorded price exists. Legacy PLACE requires at least eight unchanged active starters and complete top-three results; decision rows with verified paid-place terms use the matching top-two/top-three probability and finishing cutoff. These are recorded-price simulations, not guaranteed executable TAB returns or audited bookmaker settlements.
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

For focused TAB settlement verification, use `npx tsx scripts/verify-historical-simulator.ts http://localhost:3038 --tab-settlement`. It verifies independent WIN/PLACE settlement, exact selection-time quotes, missing-quote exclusions, profit/ROI, CSV provenance, preference persistence and desktop/mobile layout using intercepted fixtures only. The older full verifier's saved-strategy flow still assumes browser-only saves and needs updating before it can validate the shared database workflow.

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