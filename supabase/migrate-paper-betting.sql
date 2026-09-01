-- Paper betting / value engine schema (PuntersEdge integration).
-- Run in Supabase SQL Editor after supabase/schema.sql. Additive only - does not touch the
-- existing Racing.com-sourced horse tables (races/horses/race_entries/predictions).
--
-- Race identity here is PuntersEdge's own race_id (its next-to-go/results feed is the source of
-- truth for this engine), not the existing internal `races` table - the two systems are kept
-- deliberately independent rather than attempting fragile venue+race_number+time matching.

create extension if not exists "uuid-ossp";

-- One row per PuntersEdge race currently tracked (upcoming through settled).
create table public.pe_races (
  id text primary key, -- PuntersEdge race_id
  category text not null check (category in ('horse', 'greyhound', 'harness')),
  venue text not null,
  race_number int not null,
  race_name text,
  start_time timestamptz not null,
  country text,
  distance_m int,
  track_condition text,
  status text not null default 'upcoming' check (status in ('upcoming', 'started', 'final', 'abandoned')),
  last_raw_payload jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table public.pe_runners (
  id uuid default uuid_generate_v4() primary key,
  race_id text references public.pe_races(id) on delete cascade not null,
  runner_number int not null,
  name text not null,
  barrier int,
  jockey text,
  trainer text,
  form text,
  scratched boolean default false not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (race_id, runner_number)
);

-- Immutable odds snapshot log - never updated in place, only ever inserted, so a bet's recorded
-- price can never be silently changed after the fact.
create table public.pe_odds_snapshots (
  id uuid default uuid_generate_v4() primary key,
  race_id text references public.pe_races(id) on delete cascade not null,
  runner_id uuid references public.pe_runners(id) on delete cascade not null,
  captured_at timestamptz default now() not null,
  tab_win_price numeric,
  tab_place_price numeric,
  tab_age_seconds int,
  best_price numeric,
  best_bookmaker_key text,
  median_price numeric,
  average_price numeric,
  num_bookmakers int,
  minutes_to_jump numeric
);

-- Immutable log of every recommendation the engine produced (BET/WATCH/NO_BET), one row per
-- generation run per runner, for later model-validation/calibration analysis.
create table public.pe_recommendations (
  id uuid default uuid_generate_v4() primary key,
  race_id text references public.pe_races(id) on delete cascade not null,
  runner_id uuid references public.pe_runners(id) on delete cascade not null,
  generated_at timestamptz default now() not null,
  model_version text not null,
  category text not null check (category in ('horse', 'greyhound', 'harness')),
  model_probability numeric not null,
  tab_win_price numeric,
  tab_age_seconds int,
  edge_points numeric,
  expected_value numeric,
  confidence_level text check (confidence_level in ('VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH')),
  decision text not null check (decision in ('BET', 'WATCH', 'NO_BET')),
  minutes_to_jump numeric,
  feature_completeness numeric,
  reasons jsonb,
  failed_criteria jsonb,
  thresholds jsonb
);

create table public.paper_accounts (
  id uuid default uuid_generate_v4() primary key,
  name text unique not null default 'default',
  starting_bankroll numeric not null check (starting_bankroll > 0),
  current_bankroll numeric not null,
  staking_method text not null default 'flat-1pct' check (staking_method in ('flat-1pct', 'flat-2pct', 'kelly-0.10', 'kelly-0.25')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table public.paper_bets (
  id uuid default uuid_generate_v4() primary key,
  account_id uuid references public.paper_accounts(id) not null,
  race_id text references public.pe_races(id) not null,
  runner_id uuid references public.pe_runners(id) not null,
  runner_name text not null, -- denormalized so history survives even if the runner row is pruned
  category text not null check (category in ('horse', 'greyhound', 'harness')),
  mode text not null check (mode in ('AUTO', 'MANUAL')),
  bet_type text not null default 'WIN' check (bet_type in ('WIN', 'PLACE')),
  stake numeric not null check (stake > 0),
  -- TAB decimal odds recorded AT PLACEMENT TIME. Never update this column after insert.
  tab_decimal_odds numeric not null check (tab_decimal_odds > 1),
  model_probability numeric not null,
  model_version text not null,
  edge_points numeric,
  expected_value numeric,
  confidence_level text check (confidence_level in ('VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH')),
  recommendation_id uuid references public.pe_recommendations(id),
  placed_at timestamptz default now() not null,
  minutes_to_jump_at_placement numeric,
  status text not null default 'PENDING' check (status in ('PENDING', 'WON', 'LOST', 'VOID', 'SCRATCHED', 'ABANDONED')),
  settled_at timestamptz,
  return_amount numeric,
  profit numeric,
  bankroll_after numeric,
  -- Guards against a double-submitted manual bet click creating two identical rows.
  idempotency_key text unique,
  created_at timestamptz default now() not null
);

-- Audit trail for settlement - required by the spec, and useful for debugging a bad settlement.
create table public.pe_settlement_audit (
  id uuid default uuid_generate_v4() primary key,
  paper_bet_id uuid references public.paper_bets(id) not null,
  event text not null,
  detail jsonb,
  created_at timestamptz default now() not null
);

-- API credit/budget tracking, polled from GET /v1/usage.
create table public.pe_api_usage (
  id uuid default uuid_generate_v4() primary key,
  checked_at timestamptz default now() not null,
  credits_used int,
  credits_remaining int,
  period_start timestamptz,
  next_reset_at timestamptz,
  raw jsonb
);

create index idx_pe_races_start_time on public.pe_races(start_time);
create index idx_pe_races_category on public.pe_races(category);
create index idx_pe_runners_race_id on public.pe_runners(race_id);
create index idx_pe_odds_snapshots_runner_captured on public.pe_odds_snapshots(runner_id, captured_at desc);
create index idx_pe_recommendations_race on public.pe_recommendations(race_id);
create index idx_pe_recommendations_decision on public.pe_recommendations(decision);
create index idx_paper_bets_account on public.paper_bets(account_id);
create index idx_paper_bets_status on public.paper_bets(status);
create index idx_paper_bets_placed_at on public.paper_bets(placed_at);

alter table public.pe_races enable row level security;
alter table public.pe_runners enable row level security;
alter table public.pe_odds_snapshots enable row level security;
alter table public.pe_recommendations enable row level security;
alter table public.paper_accounts enable row level security;
alter table public.paper_bets enable row level security;
alter table public.pe_settlement_audit enable row level security;
alter table public.pe_api_usage enable row level security;

-- Read-only for the public site, matching the rest of the schema; all writes go through the
-- service-role admin client (src/lib/supabase/admin.ts), same convention as every other table.
create policy "Public pe_races read access" on public.pe_races for select using (true);
create policy "Public pe_runners read access" on public.pe_runners for select using (true);
create policy "Public pe_odds_snapshots read access" on public.pe_odds_snapshots for select using (true);
create policy "Public pe_recommendations read access" on public.pe_recommendations for select using (true);
create policy "Public paper_accounts read access" on public.paper_accounts for select using (true);
create policy "Public paper_bets read access" on public.paper_bets for select using (true);
create policy "Public pe_settlement_audit read access" on public.pe_settlement_audit for select using (true);
create policy "Public pe_api_usage read access" on public.pe_api_usage for select using (true);

-- Atomically settles one pending bet and applies its profit/loss to the account's bankroll cache
-- (computeWalletStats in src/lib/betting/paper-wallet.ts remains the source of truth for display -
-- this cache just avoids replaying full bet history on every page load). The `where status =
-- 'pending'` guard makes double-settlement (e.g. a retried settlement job) a no-op rather than a
-- double-counted profit: a second call finds no matching row and returns false.
create or replace function public.settle_paper_bet(
  p_bet_id uuid,
  p_status text,
  p_return_amount numeric,
  p_profit numeric
) returns boolean
language plpgsql
as $$
declare
  v_account_id uuid;
  v_new_bankroll numeric;
begin
  if p_status not in ('WON', 'LOST', 'VOID', 'SCRATCHED', 'ABANDONED') then
    raise exception 'invalid settlement status: %', p_status;
  end if;

  update public.paper_bets
  set status = p_status,
      settled_at = now(),
      return_amount = p_return_amount,
      profit = p_profit
  where id = p_bet_id and status = 'PENDING'
  returning account_id into v_account_id;

  if v_account_id is null then
    return false; -- already settled, or no such bet - caller should not double-apply profit
  end if;

  update public.paper_accounts
  set current_bankroll = current_bankroll + p_profit,
      updated_at = now()
  where id = v_account_id
  returning current_bankroll into v_new_bankroll;

  update public.paper_bets set bankroll_after = v_new_bankroll where id = p_bet_id;

  insert into public.pe_settlement_audit (paper_bet_id, event, detail)
  values (p_bet_id, 'settled', jsonb_build_object('status', p_status, 'return_amount', p_return_amount, 'profit', p_profit));

  return true;
end;
$$;

