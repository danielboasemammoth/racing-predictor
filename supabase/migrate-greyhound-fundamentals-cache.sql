-- Caches PuntersEdge greyhound form/stats responses per dog so the fundamentals model doesn't
-- re-fetch (3cr per endpoint, 6cr/dog for both) on every ~15min poll - see the read-through cache
-- functions in src/lib/paper-betting/repository.ts (getCachedGreyhoundFundamentals /
-- upsertGreyhoundFundamentalsCache). Additive, safe to run on an existing database.
create table if not exists public.pe_greyhound_fundamentals_cache (
  dog_name text primary key,
  dog_id bigint,
  ambiguous boolean not null default false,
  form jsonb,
  box_stats jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_pe_greyhound_fundamentals_cache_fetched_at
  on public.pe_greyhound_fundamentals_cache(fetched_at);

alter table public.pe_greyhound_fundamentals_cache enable row level security;

-- Read-only for the public site, matching the rest of the schema; all writes go through the
-- service-role admin client (src/lib/supabase/admin.ts).
create policy "Public pe_greyhound_fundamentals_cache read access"
  on public.pe_greyhound_fundamentals_cache for select using (true);
