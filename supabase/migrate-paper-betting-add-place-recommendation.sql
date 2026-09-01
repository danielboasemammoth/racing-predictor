-- Follow-up migration: adds Harville place-recommendation columns to a database that already ran
-- the original migrate-paper-betting.sql (+ migrate-paper-betting-add-place-price.sql). Idempotent.
alter table public.pe_recommendations add column if not exists place_model_probability numeric;
alter table public.pe_recommendations add column if not exists place_edge_points numeric;
alter table public.pe_recommendations add column if not exists place_expected_value numeric;
alter table public.pe_recommendations add column if not exists place_decision text
  check (place_decision in ('BET', 'WATCH', 'NO_BET'));
