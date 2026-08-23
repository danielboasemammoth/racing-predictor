-- Allow multiple timestamped prediction snapshots per race/model instead of a single
-- row that gets overwritten on every refresh, so prediction and market movement can
-- be analysed over time. Safe to run multiple times.
begin;

alter table public.predictions
	drop constraint if exists predictions_race_id_model_version_key;

create index if not exists idx_predictions_race_model_latest
	on public.predictions (race_id, model_version, predicted_at desc);

commit;
