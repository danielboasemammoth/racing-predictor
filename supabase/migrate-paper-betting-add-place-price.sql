-- Follow-up migration: adds tab_place_price (needed for manual PLACE paper bets) to a database
-- that already ran the original migrate-paper-betting.sql. Safe to re-run (idempotent).
alter table public.pe_recommendations add column if not exists tab_place_price numeric;
