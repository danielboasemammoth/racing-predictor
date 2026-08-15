-- Upgrade an existing Racing Predictor database without recreating tables.
begin;

-- Keep the newest prediction for each race/model before enforcing uniqueness.
delete from public.predictions older
using public.predictions newer
where older.race_id = newer.race_id
	and older.model_version = newer.model_version
	and (
		older.predicted_at < newer.predicted_at
		or (older.predicted_at = newer.predicted_at and older.id < newer.id)
	);

-- Legacy accuracy rows may not have a model version.
update public.accuracy_log
set model_version = 'unknown'
where model_version is null;

-- Keep the newest aggregate for each period/model before enforcing uniqueness.
delete from public.accuracy_log older
using public.accuracy_log newer
where older.period_start = newer.period_start
	and older.period_end = newer.period_end
	and older.model_version = newer.model_version
	and (
		older.logged_at < newer.logged_at
		or (older.logged_at = newer.logged_at and older.id < newer.id)
	);

alter table public.accuracy_log
	alter column model_version set not null;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conrelid = 'public.predictions'::regclass
			and contype = 'u'
			and conname = 'predictions_race_id_model_version_key'
	) then
		alter table public.predictions
			add constraint predictions_race_id_model_version_key
			unique (race_id, model_version);
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conrelid = 'public.accuracy_log'::regclass
			and contype = 'u'
			and conname = 'accuracy_log_period_start_period_end_model_version_key'
	) then
		alter table public.accuracy_log
			add constraint accuracy_log_period_start_period_end_model_version_key
			unique (period_start, period_end, model_version);
	end if;
end
$$;

alter table public.racecourses enable row level security;
alter table public.races enable row level security;
alter table public.horses enable row level security;
alter table public.race_entries enable row level security;
alter table public.predictions enable row level security;
alter table public.accuracy_log enable row level security;
alter table public.data_sources enable row level security;

drop policy if exists "Public racecourse read access" on public.racecourses;
drop policy if exists "Public race read access" on public.races;
drop policy if exists "Public horse read access" on public.horses;
drop policy if exists "Public race entry read access" on public.race_entries;
drop policy if exists "Public prediction read access" on public.predictions;
drop policy if exists "Public accuracy read access" on public.accuracy_log;

create policy "Public racecourse read access"
	on public.racecourses for select using (true);
create policy "Public race read access"
	on public.races for select using (true);
create policy "Public horse read access"
	on public.horses for select using (true);
create policy "Public race entry read access"
	on public.race_entries for select using (true);
create policy "Public prediction read access"
	on public.predictions for select using (true);
create policy "Public accuracy read access"
	on public.accuracy_log for select using (true);

commit;