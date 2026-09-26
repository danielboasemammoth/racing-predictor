# Page Snapshots

Home, Results, Past Picks, Accuracy, Analytics, Greyhounds, and the Paper Betting reports read precomputed snapshots instead of scanning source tables during rendering. Paper Betting's wallet and bet history remain live, with a shared five-second read deadline. Betting actions and bankroll/staking settings are unchanged. Race detail, admin, verification, and interactive simulations remain outside this cache.

## Storage and Reads

- The existing `analysis_snapshots` table stores one JSON payload and generation timestamp per `page-cache-v1:<key>`. No migration is required. These snapshots contain public page data; reads use the anonymous client, while publishing requires the service-role client.
- Next's persistent Data Cache revalidates every 60 seconds and retains successful data when revalidation fails. A 30-second process cache coalesces concurrent reads and retains the last successful snapshot when storage fails.
- A cold snapshot read has a five-second fetch deadline, with Supabase automatic retries disabled. Missing data renders an explicit unavailable state, never a live expensive-query fallback. Failed reads do not publish empty snapshots.
- Every displayed snapshot identifies its last successful refresh time. Upcoming races are filtered against request time; opportunity quotes expire after 30 minutes or race start. Greyhounds is dynamic so this expiry runs on each request.
- An entirely cold deployment still needs Supabase to retrieve its first snapshot. The Next/process caches protect warmed instances, not a first-ever load during a complete database outage.

## After-Run Refreshes

The daily pipeline refreshes `home`, `opportunities`, `results`, `validation`, `place-shadow`, `picks-history`, `accuracy`, and `analytics`. The odds poll refreshes `opportunities`, `validation`, and `place-shadow`, the data affected by that poll.

Each task calls the authenticated `POST /api/admin/page-cache` endpoint once per key from its cleanup path, even after an earlier step fails (provided app discovery and authentication succeeded). Keys run sequentially, with a 300-second HTTP timeout per key. A failed refresh retains its previous snapshot, logs failure, continues to the next key, and makes the task exit nonzero. Cleanup still stops an instance started by the task. Task Scheduler termination or machine shutdown can prevent cleanup from running.

Generation time is captured before source loading. Conditional publication prevents an older overlapping job from overwriting a newer generation. A successful publication invalidates the local Next cache tag with stale-while-revalidate behavior; other deployments discover the shared database update through timed revalidation. Process caching can add 30 seconds to visibility of a refresh.

Home snapshots include precomputed reliability and compact forecast data; user-selected sorting and filters still run at request time. Past Picks retains its seven-day window. Accuracy and Analytics calculate historical metrics during refresh, not rendering. Metrics queries paginate at Supabase's 1,000-row response cap.

Home also stores `tabRaceIds`, confirmed against TAB's public VIC-jurisdiction schedule for each Melbourne race date. Matching uses venue, race number, and the existing 20-minute start-time tolerance. Only thoroughbred races with tote, fixed odds, or announced future fixed odds qualify; abandoned races do not. All home-page shortlists and race cards use this allowlist, independently of prediction odds. A failed TAB lookup fails the refresh and retains the previous snapshot. Legacy snapshots without the allowlist display a refresh-required state until `home` is refreshed. No TAB request runs during page rendering.

## Bootstrap and Recovery

After building the updated app, bootstrap all snapshots from the project root:

```powershell
npx tsx --env-file=.env.local scripts/refresh-page-cache.ts
```

Optional positional keys limit the refresh, for example `home results`. The CLI requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, publishes independently per key, logs durations, and exits nonzero if any publication fails. It does not scrape, generate predictions, place bets, or change financial settings. CLI publication is picked up through timed cache revalidation.

During a provider outage, do not delete existing snapshots or replace them with fabricated empty data. Restore database availability, then use the command above or allow the next scheduled run to publish. Logs are in the existing task log files, with `Page snapshot <key>` entries. The initial September 21 bootstrap attempt was blocked by upstream timeouts; a first successful live publication and live payload-size measurements remain pending database recovery.

## Verification

Regression coverage includes coalesced reads, last-good retention, conditional publication, failed-refresh isolation, authenticated refreshes, quote/race expiry, reliability parity, report pagination, and PowerShell cleanup hooks. Run `npm test`, `npm run lint`, `npm run build`, and `./scripts/windows/test-daily-pipeline.ps1`.

September 21 production-mode outage checks: all seven pages returned HTTP 200 at desktop and mobile widths. With no prior snapshot, the homepage rendered unavailable in about 5.1 seconds versus 27 seconds before disabling client retries; an immediate repeated request took 61 ms. These are outage-state measurements, not successful live-data cache benchmarks.