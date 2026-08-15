-- Racing Predictor Database Schema
-- Run in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Racecourses
create table public.racecourses (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  state text not null,
  region text,
  created_at timestamptz default now() not null
);

-- Races (upcoming and completed)
create table public.races (
  id uuid default uuid_generate_v4() primary key,
  external_id text unique,
  racecourse_id uuid references public.racecourses(id) not null,
  race_number int not null,
  race_name text,
  distance_m int,
  track_condition text,
  weather_condition text,
  race_class text,
  prize_money numeric,
  race_datetime timestamptz not null,
  status text default 'upcoming' check (status in ('upcoming', 'live', 'completed', 'cancelled')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Horses
create table public.horses (
  id uuid default uuid_generate_v4() primary key,
  external_id text unique,
  name text not null,
  sex text,
  age int,
  sire text,
  dam text,
  trainer text,
  owner text,
  career_runs int default 0,
  career_wins int default 0,
  career_places int default 0,
  total_prize_money numeric default 0,
  best_time_this_distance numeric,
  wet_form_rating numeric,
  heavy_form_rating numeric,
  dry_form_rating numeric,
  last_race_date date,
  last_race_result text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Race entries (horses in a specific race)
create table public.race_entries (
  id uuid default uuid_generate_v4() primary key,
  race_id uuid references public.races(id) on delete cascade not null,
  horse_id uuid references public.horses(id) not null,
  barrier_number int,
  weight_carried numeric,
  jockey text,
  trainer text,
  finishing_position int,
  finishing_time numeric,
  sectional_times jsonb,
  margin numeric,
  status text default 'running' check (status in ('running', 'finished', 'scratched', 'did_not_finish')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(race_id, horse_id)
);

-- Predictions
create table public.predictions (
  id uuid default uuid_generate_v4() primary key,
  race_id uuid references public.races(id) on delete cascade not null,
  model_version text not null,
  predicted_at timestamptz default now() not null,
  predictions jsonb not null,
  confidence_scores jsonb not null,
  predicted_times jsonb not null,
  actual_results jsonb,
  accuracy_score numeric,
  created_at timestamptz default now() not null
);

-- Accuracy log (daily/weekly aggregates)
create table public.accuracy_log (
  id uuid default uuid_generate_v4() primary key,
  logged_at timestamptz default now() not null,
  period_start date not null,
  period_end date not null,
  total_races int not null,
  correct_winners int not null,
  correct_podiums int not null,
  winner_accuracy numeric not null,
  podium_accuracy numeric not null,
  avg_confidence numeric,
  avg_time_error numeric,
  model_version text
);

-- Data sources (track where data came from)
create table public.data_sources (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  source_type text not null check (source_type in ('scrape', 'api', 'manual', 'import')),
  url text,
  last_synced timestamptz,
  sync_frequency text,
  active boolean default true,
  created_at timestamptz default now() not null
);

-- Indexes
create index idx_races_racecourse_id on public.races(racecourse_id);
create index idx_races_race_datetime on public.races(race_datetime);
create index idx_races_status on public.races(status);
create index idx_race_entries_race_id on public.race_entries(race_id);
create index idx_race_entries_horse_id on public.race_entries(horse_id);
create index idx_horses_trainer on public.horses(trainer);
create index idx_horses_last_race_date on public.horses(last_race_date);
create index idx_predictions_race_id on public.predictions(race_id);
create index idx_accuracy_log_period on public.accuracy_log(period_start, period_end);
