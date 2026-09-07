-- Adds field_size (count of non-scratched runners) to pe_recommendations, so we can later test
-- whether maxOdds (recommendation-engine.ts) should vary by field size instead of being a flat
-- $15 cap for every race - see the 2026-09-07 entry in /memories/repo/racing-predictor-notes.md.
-- Purely additive, no data migration needed for existing rows (NULL for historical rows is fine,
-- this is analysis-only and not read by any live code path yet).

alter table public.pe_recommendations
  add column if not exists field_size int;
