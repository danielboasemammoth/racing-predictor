-- STAGE 1 of the Betfair integration (architecture/simulation only - no live credentials wired yet).
-- Entirely additive: new tables only, does not touch paper_bets/paper_accounts (PuntersEdge system).
-- All ledgers here are SIMULATION-only until Stage 2+ adds a real BetfairExecutionProvider.

-- Configurable commission rates per market - NEVER hardcode a Market Base Rate in application code.
create table if not exists public.betfair_market_base_rates (
  id uuid primary key default gen_random_uuid(),
  market_id text,
  jurisdiction text not null default 'AUS',
  state text,
  racing_code text not null check (racing_code in ('horse', 'greyhound', 'harness')),
  market_base_rate numeric not null check (market_base_rate >= 0 and market_base_rate <= 1),
  source text not null,
  effective_date date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists idx_betfair_mbr_state_code on public.betfair_market_base_rates(state, racing_code);

-- Singleton bankroll allocation config. Never a deposit/withdrawal mechanism - purely an
-- application-level risk boundary the user sets manually.
create table if not exists public.betfair_bankroll_config (
  id uuid primary key default gen_random_uuid(),
  actual_betfair_balance numeric,
  allocated_bankroll numeric not null default 100,
  reserve_balance numeric not null default 0,
  max_automation_pct numeric not null default 1.0 check (max_automation_pct >= 0 and max_automation_pct <= 1),
  bankroll_ceiling numeric,
  withdrawal_threshold numeric,
  topup_threshold numeric,
  simulated_starting_bankroll numeric not null default 100,
  simulated_current_bankroll numeric not null default 100,
  updated_at timestamptz not null default now()
);

-- Singleton risk/staking settings, conservative defaults per product spec.
create table if not exists public.betfair_risk_settings (
  id uuid primary key default gen_random_uuid(),
  min_confidence numeric not null default 0.5,
  min_edge_pct numeric not null default 5,
  min_expected_value numeric not null default 0,
  min_odds numeric not null default 1.5,
  max_odds numeric not null default 20,
  min_liquidity numeric not null default 50,
  max_liquidity_consumption_pct numeric not null default 0.20,
  max_bet numeric not null default 2,
  max_pct_bankroll numeric not null default 0.01,
  max_total_exposure_pct numeric not null default 0.05,
  max_daily_stake numeric not null default 20,
  max_daily_loss_pct numeric not null default 0.05,
  max_bets_per_day integer not null default 10,
  max_bets_per_race integer not null default 1,
  min_minutes_to_jump numeric not null default 2,
  max_minutes_to_jump numeric not null default 60,
  permitted_codes text[] not null default array['horse', 'greyhound'],
  permitted_states text[] not null default array['VIC','NSW','QLD','SA','WA','TAS','NT','ACT'],
  horse_enabled boolean not null default true,
  greyhound_enabled boolean not null default true,
  nsw_thoroughbred_auto_enabled boolean not null default false,
  staking_method text not null default 'kelly-0.10' check (staking_method in ('flat', 'pct-bankroll', 'kelly-0.10', 'kelly-0.25', 'kelly-0.50', 'conservative')),
  flat_stake_amount numeric not null default 2,
  pct_bankroll_stake numeric not null default 0.01,
  order_transaction_hourly_ceiling integer not null default 100,
  updated_at timestamptz not null default now()
);

-- Singleton automation/mode state. live_betting_enabled MUST default false and requires the
-- activation checklist (see BETTING_RISK_ENGINE.md) to pass before the app allows it to be true.
create table if not exists public.betfair_automation_state (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'SIMULATION' check (mode in ('SIMULATION', 'LIVE_MANUAL', 'LIVE_AUTO')),
  live_betting_enabled boolean not null default false,
  daily_loss_stop_triggered_at timestamptz,
  paused_reason text,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Unified bet ledger for the Betfair-shaped system (separate from paper_bets/PuntersEdge).
-- bet_mode distinguishes simulation vs real-money rows so ledgers are never mixed.
create table if not exists public.betfair_bets (
  id uuid primary key default gen_random_uuid(),
  market_id text not null,
  selection_id text not null,
  runner_name text not null,
  racing_code text not null check (racing_code in ('horse', 'greyhound', 'harness')),
  venue text,
  race_number integer,
  state text,
  jump_time timestamptz,
  side text not null default 'BACK' check (side in ('BACK', 'LAY')),
  bet_mode text not null check (bet_mode in ('SIMULATION', 'LIVE_MANUAL', 'LIVE_AUTO')),
  placement text not null default 'MANUAL' check (placement in ('MANUAL', 'AUTOMATIC')),
  model_probability numeric,
  market_probability numeric,
  fair_odds numeric,
  requested_odds numeric not null,
  min_acceptable_odds numeric not null,
  matched_odds numeric,
  requested_stake numeric not null,
  matched_stake numeric,
  unmatched_stake numeric,
  staking_method text,
  raw_edge_pct numeric,
  commission_adjusted_edge_pct numeric,
  confidence numeric,
  liquidity_available numeric,
  status text not null default 'PENDING' check (status in ('PENDING', 'MATCHED', 'PARTIALLY_MATCHED', 'UNMATCHED', 'WON', 'LOST', 'VOID', 'CANCELLED')),
  betfair_bet_id text,
  market_base_rate numeric,
  gross_profit numeric,
  commission numeric,
  nsw_turnover_charge numeric,
  net_profit numeric,
  bankroll_before numeric,
  bankroll_after numeric,
  model_version text,
  feature_version text,
  rejection_reason text,
  idempotency_key text not null unique,
  placed_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists idx_betfair_bets_mode on public.betfair_bets(bet_mode);
create index if not exists idx_betfair_bets_status on public.betfair_bets(status);
create index if not exists idx_betfair_bets_placed_at on public.betfair_bets(placed_at desc);

-- Racing NSW turnover-charge tracking (weekly aggregation, per current Betfair rules described
-- in BETTING_RISK_ENGINE.md - re-verify against official docs before relying on this for real money).
create table if not exists public.betfair_nsw_turnover_weekly (
  week_start date primary key,
  matched_back_turnover numeric not null default 0,
  commission_paid numeric not null default 0,
  commission_to_turnover_ratio numeric,
  threshold_state text not null default 'ok' check (threshold_state in ('ok', 'warning', 'strong_warning', 'blocked')),
  updated_at timestamptz not null default now()
);

-- Immutable-ish audit trail for every sensitive action.
create table if not exists public.betfair_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  actor text not null default 'system'
);
create index if not exists idx_betfair_audit_log_occurred_at on public.betfair_audit_log(occurred_at desc);

insert into public.betfair_bankroll_config (id)
  select gen_random_uuid() where not exists (select 1 from public.betfair_bankroll_config);
insert into public.betfair_risk_settings (id)
  select gen_random_uuid() where not exists (select 1 from public.betfair_risk_settings);
insert into public.betfair_automation_state (id)
  select gen_random_uuid() where not exists (select 1 from public.betfair_automation_state);
