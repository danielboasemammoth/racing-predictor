-- Adds sectional speed, race-shape/pace, stewards, gear, rating, and track-geometry data
-- discovered to be freely available from Racing.com's own GraphQL API (see racing-com.ts) -
-- no TAB/Betfair/paid provider needed for any of these columns.
-- Run in the Supabase Dashboard SQL Editor.

alter table public.races
  add column if not exists stewards_report_html text,
  add column if not exists tempo text,
  add column if not exists track_straight_m int,
  add column if not exists track_circumference_m int;

alter table public.race_entries
  add column if not exists speed_ratings jsonb,
  add column if not exists running_positions jsonb,
  add column if not exists stewards_comment text,
  add column if not exists gear_changes text,
  add column if not exists handicap_rating numeric,
  add column if not exists starting_price numeric;
