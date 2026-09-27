create index if not exists idx_races_completed_recent
  on public.races (race_datetime desc, id desc) where status = 'completed';

create or replace function public.simulation_race_window()
returns table (id uuid, fingerprint text)
language sql stable security invoker set search_path = public
as $$
  select recent.id, md5(concat_ws('|', to_jsonb(recent)::text, course.name, course.state,
    (select jsonb_agg(jsonb_build_array(entry.horse_id, entry.status, entry.finishing_position, entry.updated_at) order by entry.horse_id)::text
      from public.race_entries entry where entry.race_id = recent.id),
    (select max(prediction.created_at)::text from public.predictions prediction where prediction.race_id = recent.id
      and prediction.predicted_at < recent.race_datetime and prediction.created_at < recent.race_datetime)))
  from (
    select race.id, race.updated_at, race.race_datetime, race.race_number, race.racecourse_id from public.races race
    where race.status = 'completed' and race.race_datetime < now()
    order by race.race_datetime desc, race.id desc limit 1000
  ) recent join public.racecourses course on course.id = recent.racecourse_id
  order by recent.race_datetime desc, recent.id desc;
$$;

create or replace function public.simulation_race_sources(race_ids uuid[], model_versions text[])
returns setof jsonb
language plpgsql stable security invoker set search_path = public
as $$
begin
  if coalesce(cardinality(race_ids), 0) > 20 or coalesce(cardinality(model_versions), 0) > 20 then
    raise exception 'Simulation batch limit exceeded';
  end if;
  return query
  select jsonb_build_object(
    'id', race.id, 'start', race.race_datetime, 'settledAt', greatest(race.updated_at, (select max(entry.updated_at) from public.race_entries entry where entry.race_id = race.id)),
    'venue', course.name, 'state', course.state, 'number', race.race_number,
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
      'horse_id', entry.horse_id, 'position', entry.finishing_position, 'status', entry.status))
      from public.race_entries entry where entry.race_id = race.id), '[]'::jsonb),
    'forecasts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', latest.id, 'model', latest.model_version, 'predictedAt', latest.predicted_at,
      'createdAt', latest.created_at, 'podium', latest.predictions->'podium',
      'field', (select jsonb_agg(horse->>'horse_id')
        from jsonb_array_elements(case when jsonb_typeof(latest.predictions->'all_horses') = 'array' then latest.predictions->'all_horses' else '[]'::jsonb end) horse)))
      from unnest(model_versions) model_name
      cross join lateral (
        select prediction.id, prediction.model_version, prediction.predicted_at, prediction.created_at, prediction.predictions
        from public.predictions prediction
        where prediction.race_id = race.id and prediction.model_version = model_name
          and prediction.model_version not like '%retrospective%'
          and prediction.predicted_at < race.race_datetime and prediction.created_at < race.race_datetime
        order by prediction.predicted_at desc, prediction.id desc limit 1
      ) latest), '[]'::jsonb)
  ) from public.races race join public.racecourses course on course.id = race.racecourse_id
  where race.id = any(race_ids) and race.status = 'completed';
end;
$$;

revoke all on function public.simulation_race_window() from public, anon, authenticated;
revoke all on function public.simulation_race_sources(uuid[], text[]) from public, anon, authenticated;
grant execute on function public.simulation_race_window() to service_role;
grant execute on function public.simulation_race_sources(uuid[], text[]) to service_role;

create table if not exists public.reporting_job_leases (
  name text primary key,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.reporting_job_leases enable row level security;
revoke all on public.reporting_job_leases from anon, authenticated;
grant all on public.reporting_job_leases to service_role;

create or replace function public.acquire_reporting_lease(job_name text, lease_token uuid)
returns boolean language sql volatile security invoker set search_path = public
as $$
  with acquired as (
    insert into public.reporting_job_leases(name, token, expires_at)
    values (job_name, lease_token, now() + interval '15 minutes')
    on conflict (name) do update set token = excluded.token, expires_at = excluded.expires_at
      where reporting_job_leases.expires_at <= now()
    returning name
  ) select exists(select 1 from acquired);
$$;
revoke all on function public.acquire_reporting_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_reporting_lease(text, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('racing-reports', 'racing-reports', true, 2000000, array['application/json'])
on conflict (id) do nothing;