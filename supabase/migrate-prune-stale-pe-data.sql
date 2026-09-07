-- Prunes low-value historical rows from the two fastest-growing PuntersEdge tables. Both write a
-- fresh row per runner on every ~15min poll for as long as a race is priced (commonly hours before
-- jump), so almost all rows are superseded snapshots by the time the race actually runs - only the
-- LATEST recommendation/odds-snapshot per runner has any ongoing value (live reads only ever look
-- at the last 30 minutes anyway - see queryLatestOpportunities/data-quality-query.ts). Partitions
-- by runner_id alone (not race_id, runner_id) - pe_runners is upserted per (race_id, runner_number),
-- never duplicated, so a runner_id already maps to exactly one race.
-- Never deletes a pe_recommendations row referenced by paper_bets.recommendation_id.
-- Run once now to reclaim space, then call periodically (wired into the daily pipeline) to prevent
-- this from recurring.
--
-- Takes a batch_size and deletes at most that many rows per call (a single unbounded delete over
-- 300k+ rows hits the platform's upstream request timeout, which is a separate, shorter ceiling
-- than Postgres's own statement_timeout and can't be raised from inside the function) - call
-- repeatedly from the caller until it returns 0.

create index if not exists idx_pe_recommendations_runner_generated
  on public.pe_recommendations(runner_id, generated_at desc);

create or replace function public.prune_stale_pe_recommendations(batch_size int default 5000) returns bigint
language plpgsql
set statement_timeout = '30s'
as $$
declare
  v_deleted bigint;
begin
  delete from public.pe_recommendations
  where ctid in (
    select r.ctid
    from public.pe_recommendations r
    where not exists (select 1 from public.paper_bets b where b.recommendation_id = r.id)
      and exists (
        select 1 from public.pe_recommendations r2
        where r2.runner_id = r.runner_id and r2.generated_at > r.generated_at
      )
    limit batch_size
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.prune_stale_pe_odds_snapshots(batch_size int default 5000) returns bigint
language plpgsql
set statement_timeout = '30s'
as $$
declare
  v_deleted bigint;
begin
  delete from public.pe_odds_snapshots
  where ctid in (
    select s.ctid
    from public.pe_odds_snapshots s
    where exists (
      select 1 from public.pe_odds_snapshots s2
      where s2.runner_id = s.runner_id and s2.captured_at > s.captured_at
    )
    limit batch_size
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
