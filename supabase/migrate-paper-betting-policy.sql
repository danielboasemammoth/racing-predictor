begin;

alter table public.paper_bets add column if not exists policy_version text;
create index if not exists idx_paper_bets_policy on public.paper_bets(account_id, policy_version, placed_at);

comment on column public.paper_bets.policy_version is
  'Selection policy recorded at placement; NULL means untagged/unknown, never inferred from placement date or model version.';

commit;