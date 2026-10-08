-- ============================================================================
-- SAKDHA MARKETPLACE — Settlement periods (0010)
--
-- A settlement run must be safe to re-run: an admin re-running October must
-- update October's row, never create a second one. Without a unique key the
-- same period could be settled twice and a seller paid twice.
--
-- `period` is a calendar month, 'YYYY-MM'.
-- ============================================================================

-- Fail loudly if duplicates already exist rather than silently dropping rows.
do $$
declare dupes integer;
begin
  select count(*) into dupes
    from (
      select seller_id, period
        from public.settlements
       group by seller_id, period
      having count(*) > 1
    ) d;
  if dupes > 0 then
    raise exception 'Cannot add the unique key: % seller/period duplicates exist', dupes;
  end if;
end $$;

alter table public.settlements
  add constraint settlements_seller_period_key unique (seller_id, period);

create index if not exists settlements_period_idx on public.settlements(period);

-- The settlement run reads the ledger per seller per month; without this the
-- scan grows with total platform volume rather than the seller's own.
create index if not exists ledger_entries_seller_created_idx
  on public.ledger_entries(seller_id, created_at);

comment on column public.settlements.period is 'Calendar month, YYYY-MM';
comment on column public.settlements.net_payable is
  'What Sakdha owes the seller for the period: SELLER_PAYABLE less refunds, in paise';
