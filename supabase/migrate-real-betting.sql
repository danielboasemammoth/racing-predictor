-- Real betting ledger (provider: TAB). Additive and idempotent; run once in the Supabase SQL Editor.
-- No provider connection exists yet: the app only inserts DRY_RUN attempts (always blocked) and
-- never writes real_bets. Both tables are private to service_role; no anon/authenticated access.

create table if not exists public.real_bets (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  provider text not null check (provider = 'tab'),
  provider_order_id text unique check (provider_order_id is null or char_length(provider_order_id) between 1 and 200),
  strategy_name text not null check (char_length(strategy_name) between 1 and 120),
  strategy_hash text not null check (strategy_hash ~ '^[0-9a-f]{64}$'),
  strategy_snapshot jsonb not null,
  risk_limits jsonb not null,
  quote_snapshot jsonb not null,
  race_ref text not null check (char_length(race_ref) between 1 and 200),
  selection_ref text not null check (char_length(selection_ref) between 1 and 200),
  market text not null check (market in ('WIN', 'PLACE')),
  quoted_odds numeric(10, 2) not null check (quoted_odds > 1),
  quoted_at timestamptz not null,
  stake numeric(12, 2) not null check (stake > 0),
  currency text not null default 'AUD' check (currency = 'AUD'),
  status text not null default 'PENDING_SUBMISSION'
    check (status in ('PENDING_SUBMISSION', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'SETTLED')),
  outcome text check (outcome in ('WON', 'LOST', 'VOID')),
  return_amount numeric(12, 2) check (return_amount >= 0),
  provider_settlement_ref text,
  settlement_verified_at timestamptz,
  submitted_at timestamptz,
  accepted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint real_bets_settled_has_outcome check ((status = 'SETTLED') = (outcome is not null)),
  constraint real_bets_return_requires_outcome check (return_amount is null or outcome is not null),
  constraint real_bets_outcome_requires_verified_settlement check (outcome is null or (
    provider_order_id is not null and provider_settlement_ref is not null
    and settlement_verified_at is not null and settled_at is not null and return_amount is not null)),
  constraint real_bets_lost_returns_nothing check (outcome is distinct from 'LOST' or return_amount = 0),
  constraint real_bets_accepted_requires_order check (status not in ('ACCEPTED', 'SETTLED') or (provider_order_id is not null and accepted_at is not null))
);

create index if not exists idx_real_bets_created on public.real_bets (created_at desc, id desc);
create index if not exists idx_real_bets_open on public.real_bets (status) where status in ('PENDING_SUBMISSION', 'SUBMITTED', 'ACCEPTED');

create or replace function public.real_bets_guard()
returns trigger language plpgsql security invoker set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'real_bets rows are permanent';
  end if;
  if old.status = 'SETTLED' then
    raise exception 'Settled real bets are final';
  end if;
  if (new.idempotency_key, new.provider, new.strategy_name, new.strategy_hash, new.strategy_snapshot, new.risk_limits,
      new.quote_snapshot, new.race_ref, new.selection_ref, new.market, new.quoted_odds, new.quoted_at, new.stake, new.currency, new.created_at)
    is distinct from
     (old.idempotency_key, old.provider, old.strategy_name, old.strategy_hash, old.strategy_snapshot, old.risk_limits,
      old.quote_snapshot, old.race_ref, old.selection_ref, old.market, old.quoted_odds, old.quoted_at, old.stake, old.currency, old.created_at) then
    raise exception 'Real bet strategy, quote and stake are immutable';
  end if;
  if old.provider_order_id is not null and new.provider_order_id is distinct from old.provider_order_id then
    raise exception 'Provider order id cannot change once recorded';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists real_bets_guard_update on public.real_bets;
create trigger real_bets_guard_update before update on public.real_bets for each row execute function public.real_bets_guard();
drop trigger if exists real_bets_guard_delete on public.real_bets;
create trigger real_bets_guard_delete before delete on public.real_bets for each row execute function public.real_bets_guard();

create table if not exists public.real_betting_attempts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind = 'DRY_RUN'),
  idempotency_key text not null unique check (idempotency_key ~ '^dry-run:[0-9a-f-]{36}:[0-9]{12}$'),
  provider text not null check (provider = 'tab'),
  config_id uuid not null,
  runner_version text not null check (char_length(runner_version) between 1 and 40),
  strategy_name text not null check (char_length(strategy_name) between 1 and 120),
  strategy_hash text not null check (strategy_hash ~ '^[0-9a-f]{64}$'),
  strategy_snapshot jsonb not null,
  risk_limits jsonb not null,
  proposed_market text check (proposed_market in ('WIN', 'PLACE')),
  proposed_stake numeric(12, 2) check (proposed_stake > 0),
  currency text not null default 'AUD' check (currency = 'AUD'),
  decision text not null check (decision in ('BLOCKED_PROVIDER_DISCONNECTED', 'BLOCKED_RISK_LIMIT')),
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now(),
  constraint real_betting_attempts_proposal_pair check ((proposed_market is null) = (proposed_stake is null))
);

create index if not exists idx_real_betting_attempts_created on public.real_betting_attempts (created_at desc, id desc);

create or replace function public.real_betting_attempts_append_only()
returns trigger language plpgsql security invoker set search_path = public
as $$
begin
  raise exception 'real_betting_attempts is append-only';
end;
$$;

drop trigger if exists real_betting_attempts_append_only on public.real_betting_attempts;
create trigger real_betting_attempts_append_only before update or delete on public.real_betting_attempts
  for each row execute function public.real_betting_attempts_append_only();

alter table public.real_bets enable row level security;
alter table public.real_betting_attempts enable row level security;
revoke all on public.real_bets from public, anon, authenticated;
revoke all on public.real_betting_attempts from public, anon, authenticated;
revoke all on function public.real_bets_guard() from public, anon, authenticated;
revoke all on function public.real_betting_attempts_append_only() from public, anon, authenticated;
grant select, insert, update on public.real_bets to service_role;
grant select, insert on public.real_betting_attempts to service_role;

drop policy if exists real_bets_service_role on public.real_bets;
create policy real_bets_service_role on public.real_bets for all to service_role using (true) with check (true);
drop policy if exists real_betting_attempts_service_role on public.real_betting_attempts;
create policy real_betting_attempts_service_role on public.real_betting_attempts for all to service_role using (true) with check (true);
