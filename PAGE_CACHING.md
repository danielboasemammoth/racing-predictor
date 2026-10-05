# Page Snapshots

Home, Results, Past Picks, Accuracy, Analytics and Greyhounds read precomputed database snapshots instead of scanning source tables during rendering. The historical simulator at `/paper-betting` uses public Storage/CDN report chunks and performs filtering and staking locally; it does not read the wallet or source tables. Its read-only archive uses bounded live history queries. See [PAPER_BETTING.md](PAPER_BETTING.md) for the simulator migration, bootstrap and financial assumptions. Race detail, admin and verification remain outside this cache.

## Storage and Reads

- The existing `analysis_snapshots` table stores one JSON payload and generation timestamp per `page-cache-v1:<key>`. No migration is required. These snapshots contain public page data; reads use the anonymous client, while publishing requires the service-role client.
- Next's persistent Data Cache revalidates every 60 seconds and retains successful data when revalidation fails. A 30-second process cache coalesces concurrent reads and retains the last successful snapshot when storage fails.
- A cold snapshot read has a five-second fetch deadline, with Supabase automatic retries disabled. Missing data renders an explicit unavailable state, never a live expensive-query fallback. Failed reads do not publish empty snapshots.
- Every displayed snapshot identifies its last successful refresh time. Upcoming races are filtered against request time; opportunity quotes expire after 30 minutes or race start. Greyhounds is dynamic so this expiry runs on each request.
- An entirely cold deployment still needs Supabase to retrieve its first snapshot. The Next/process caches protect warmed instances, not a first-ever load during a complete database outage.

## After-Run Refreshes

The hourly pipeline refreshes `home`, `opportunities` and `results`. At 06:00 local time, or with `-Maintenance`, it additionally refreshes `validation`, `place-shadow`, `picks-history`, `accuracy` and `analytics`. The odds poll refreshes only `opportunities`. The simulator has its own hourly incremental publication endpoint and does not use the database page-snapshot cache.

Each task calls the authenticated `POST /api/admin/page-cache` endpoint once per selected key from its cleanup path. Keys run sequentially, with a 300-second HTTP timeout per key. A failed refresh retains its previous snapshot and logs failure. Recognized upstream availability errors stop remaining database work and suppress cleanup refreshes; other noncritical failures permit subsequent steps. Cleanup still stops an instance started by the task. Task Scheduler termination or machine shutdown can prevent cleanup from running.

Generation time is captured before source loading. Conditional publication prevents an older overlapping job from overwriting a newer generation. A successful publication invalidates the local Next cache tag with stale-while-revalidate behavior; other deployments discover the shared database update through timed revalidation. Process caching can add 30 seconds to visibility of a refresh.

Home snapshots include precomputed reliability and compact forecast data; user-selected sorting and filters still run at request time. Past Picks retains its seven-day window. Accuracy and Analytics calculate historical metrics during refresh, not rendering. Metrics queries paginate at Supabase's 1,000-row response cap.

Home also stores `tabRaceIds`, confirmed against TAB's public VIC-jurisdiction schedule for each Melbourne race date. Matching uses venue, race number, and the existing 20-minute start-time tolerance. Only thoroughbred races with tote, fixed odds, or announced future fixed odds qualify; abandoned races do not. All home-page shortlists and race cards use this allowlist, independently of prediction odds. A failed TAB lookup fails the refresh and retains the previous snapshot. Legacy snapshots without the allowlist display a refresh-required state until `home` is refreshed. No TAB request runs during page rendering.

## Bootstrap and Recovery

### Past Picks Provenance

Past Picks previously rebuilt a reliability-ranked top three from retrospective predictions and recalculated reliability. This was not the home-page history: the home page uses saved reliability, TAB eligibility and an uncapped default list sorted by win probability with a 50% floor. A race without a retrospective forecast could disappear entirely.

Successful home publications now append immutable `analysis_snapshots` rows keyed `home-picks-v1:<home-generation>`. They contain compact default-shortlist picks, their original probabilities/reliability, prediction IDs and observation times for today/tomorrow in Melbourne. Started races and retrospective forecasts are excluded. Ignored older generations and failed home publications do not produce archive rows. An archive-write failure after a successful home write reports `HOME_ARCHIVE_FAILED`; the home page has advanced but archive coverage has a gap. Publication is not proof that a particular visitor viewed that generation.

History joins final results onto the first archived appearance per race/horse. It preserves scratched selections, does not cap the list at three, and does not recalculate reliability using later outcomes. Custom home URL filters and later forecast changes can differ from that first default appearance. Coverage starts at activation; enabling it after a race starts does not suppress recovery of that earlier race.

For older races without archive coverage, the loader separately labels the first production forecast per race/horse to meet the 50% win floor as `Recovered pre-race forecast`. Both prediction and database creation times must precede race start. Original reliability, conservative qualification, TAB eligibility and actual home-page display remain unknown. These recovered forecasts are excluded from recorded-home-pick performance rates; no retrospective forecast or current calibration is used to fill the gap.

October 3 example verified from stored data: Toowoomba R1, Thundering Soul, forecast `c012db83-b626-474d-b6ca-0c875b78395f`, predicted `2026-10-02T20:06:52.061Z`, win probability 50.289%, top-three 63.981%, finished first. The production retrospective forecast was absent. The reported original 83/100 reliability was not retained in that forecast and is not fabricated. The read-only reproducer is `npx tsx --env-file=.env.local scripts/diagnose-picks-history.ts --history`.

No migration is needed. After deployment, refresh `home picks-history` with the normal CLI below. Hourly home publication then records new observations, while the existing morning maintenance schedule refreshes Past Picks. No predictions, results or financial settings are rewritten.

After building the updated app, bootstrap all snapshots from the project root:

```powershell
npx tsx --env-file=.env.local scripts/refresh-page-cache.ts
```

Optional positional keys limit the refresh, for example `home results`. The CLI requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, publishes independently per key, logs durations, and exits nonzero if any publication fails. It does not scrape, generate predictions, place bets, or change financial settings. CLI publication is picked up through timed cache revalidation.

During a provider outage, do not delete existing snapshots or replace them with fabricated empty data. Restore database availability, then use the command above or allow the next scheduled run to publish. Logs are in the existing task log files, with `Page snapshot <key>` entries. The initial September 21 bootstrap attempt was blocked by upstream timeouts; a first successful live publication and live payload-size measurements remain pending database recovery.

## Verification

Regression coverage includes coalesced reads, last-good retention, conditional publication, failed-refresh isolation, authenticated refreshes, quote/race expiry, reliability parity, report pagination, and PowerShell cleanup hooks. Run `npm test`, `npm run lint`, `npm run build`, and `./scripts/windows/test-daily-pipeline.ps1`.

September 21 production-mode outage checks: all seven pages returned HTTP 200 at desktop and mobile widths. With no prior snapshot, the homepage rendered unavailable in about 5.1 seconds versus 27 seconds before disabling client retries; an immediate repeated request took 61 ms. These are outage-state measurements, not successful live-data cache benchmarks.