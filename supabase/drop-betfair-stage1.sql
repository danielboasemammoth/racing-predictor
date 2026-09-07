-- Drops the Betfair Stage 1 tables (see the now-deleted supabase/migrate-betfair-stage1.sql) -
-- the feature and all its code have been removed. Run once in the Supabase SQL Editor.
drop table if exists public.betfair_audit_log;
drop table if exists public.betfair_nsw_turnover_weekly;
drop table if exists public.betfair_bets;
drop table if exists public.betfair_automation_state;
drop table if exists public.betfair_risk_settings;
drop table if exists public.betfair_bankroll_config;
drop table if exists public.betfair_market_base_rates;
