create table if not exists public.betting_strategies (
  name text primary key check (length(btrim(name)) between 1 and 120 and name = btrim(name)),
  preferences jsonb not null check (jsonb_typeof(preferences) = 'object' and preferences->>'schema' = '1'),
  saved_at timestamptz not null default now()
);

alter table public.betting_strategies enable row level security;
revoke all on public.betting_strategies from public, anon, authenticated;
grant select on public.betting_strategies to anon, authenticated;
grant all on public.betting_strategies to service_role;
drop policy if exists betting_strategies_public_read on public.betting_strategies;
create policy betting_strategies_public_read on public.betting_strategies for select to anon, authenticated using (true);