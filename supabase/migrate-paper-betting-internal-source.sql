-- Generalizes paper_bets to support paper bets on internal (Racing.com-sourced) horse races too,
-- not just PuntersEdge races - the home page's own prediction models (v4.1-ensemble etc). Additive
-- and non-destructive: existing rows keep working (source defaults to 'puntersedge').
--
-- race_id/runner_id can no longer have a single DB-level foreign key, since they now reference
-- EITHER pe_races/pe_runners (PuntersEdge) OR races/horses (internal) depending on `source`.
-- Referential integrity for the internal case is enforced at the application layer instead.
alter table public.paper_bets drop constraint if exists paper_bets_race_id_fkey;
alter table public.paper_bets drop constraint if exists paper_bets_runner_id_fkey;

alter table public.paper_bets add column if not exists source text not null default 'puntersedge'
  check (source in ('puntersedge', 'internal'));

comment on column public.paper_bets.race_id is
  'pe_races.id (text) when source=puntersedge; races.id (uuid, stored as text) when source=internal.';
comment on column public.paper_bets.runner_id is
  'pe_runners.id (uuid) when source=puntersedge; horses.id (uuid) when source=internal.';

create index if not exists idx_paper_bets_source on public.paper_bets(source);
