-- Fixes "Wipe all bets" account reset (resetAccount in src/lib/paper-betting/repository.ts):
-- deleting paper_bets failed with a foreign key violation because pe_settlement_audit rows
-- referenced them without ON DELETE CASCADE. Audit rows are meaningless once their bet is gone,
-- so cascading the delete is correct here (not a case where we want to block/preserve history).
alter table public.pe_settlement_audit drop constraint if exists pe_settlement_audit_paper_bet_id_fkey;
alter table public.pe_settlement_audit
  add constraint pe_settlement_audit_paper_bet_id_fkey
  foreign key (paper_bet_id) references public.paper_bets(id) on delete cascade;
