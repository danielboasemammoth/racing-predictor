-- Stores generated analysis artifacts (reliability calibration table, historical race
-- feature rows) so the live app can read them without depending on local script output
-- files, which don't persist across serverless deployments. One row per "kind", replaced
-- wholesale each time the analysis script runs.
begin;

create table if not exists public.analysis_snapshots (
	id uuid default uuid_generate_v4() primary key,
	kind text not null unique,
	payload jsonb not null,
	generated_at timestamptz not null default now()
);

alter table public.analysis_snapshots enable row level security;

do $$
begin
	if not exists (
		select 1 from pg_policies
		where schemaname = 'public' and tablename = 'analysis_snapshots' and policyname = 'Public analysis snapshot read access'
	) then
		create policy "Public analysis snapshot read access" on public.analysis_snapshots for select using (true);
	end if;
end
$$;

commit;
