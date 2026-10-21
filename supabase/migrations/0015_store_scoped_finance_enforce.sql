-- ============================================================================
-- SAKDHA COMMERCE — Store-scoped finance, MIGRATION C: ENFORCE (0015)
--
-- Locks in what 0013 added and 0014 populated. Requires BOTH, and requires the
-- dual-write application release to be live first — this makes columns
-- mandatory, so an older build that writes only seller_id would start failing.
--
-- Every constraint here is validated against existing rows at creation time.
-- If any statement fails, the whole migration rolls back and the data is
-- telling you the backfill is not finished. Do not weaken a constraint to make
-- it pass.
--
-- Apply with:  npm run bundle -- 0015   then paste supabase/apply_0015.sql
-- (the generated file supplies the begin/commit — do not add one here)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE ONE-TO-ONE RULE, as a constraint rather than a convention.
--
-- stores.seller_id already has a FK to sellers (0001). What was missing is
-- uniqueness: nothing stopped a seller owning two stores, which would make
-- "the store's payout account" ambiguous and every backfill above unsound.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stores_seller_unique'
  ) then
    alter table public.stores add constraint stores_seller_unique unique (seller_id);
  end if;
end $$;

-- Composite key so other tables can reference the PAIR. Postgres requires a
-- unique constraint on exactly the referenced columns for a composite FK.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stores_id_seller_key'
  ) then
    alter table public.stores add constraint stores_id_seller_key unique (id, seller_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. STORE/SELLER CONSISTENCY ON FINANCIAL ROWS.
--
-- A composite FK is what actually makes "this row's store_id and seller_id
-- refer to the same pair" unforgeable — a pair of single-column FKs cannot
-- express it, which is why a row could previously name store A and seller B.
--
-- MATCH SIMPLE (the default) skips the check when ANY referenced column is
-- NULL. That is exactly right for ledger_entries, where platform rows carry
-- neither id; section 3 adds the check that stops a HALF-filled pair.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'seller_orders_store_seller_fk') then
    alter table public.seller_orders
      add constraint seller_orders_store_seller_fk
      foreign key (store_id, seller_id) references public.stores(id, seller_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'ledger_entries_store_seller_fk') then
    alter table public.ledger_entries
      add constraint ledger_entries_store_seller_fk
      foreign key (store_id, seller_id) references public.stores(id, seller_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'settlements_store_seller_fk') then
    alter table public.settlements
      add constraint settlements_store_seller_fk
      foreign key (store_id, seller_id) references public.stores(id, seller_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. NO HALF-ATTRIBUTED LEDGER ROWS.
--
-- A row must be either fully store-scoped (both ids) or fully platform-level
-- (neither). The half-filled case is what the refund bug produced — a row with
-- an order and a seller_order but no seller_id, which settlePeriod() then
-- skipped, so the refund never reduced a payout. This makes that state
-- unrepresentable rather than merely fixed once.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ledger_entries_scope_complete') then
    alter table public.ledger_entries
      add constraint ledger_entries_scope_complete
      check (num_nonnulls(store_id, seller_id) <> 1);
  end if;
end $$;

-- Only PAYMENT_GATEWAY_FEE may be platform-level. Any other unattributed row
-- is money that belongs to someone and would quietly fall out of settlement.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ledger_entries_platform_types') then
    alter table public.ledger_entries
      add constraint ledger_entries_platform_types
      check (store_id is not null or type = 'PAYMENT_GATEWAY_FEE');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. MANDATORY WHERE IT CAN BE.
--
-- settlements: every row is a payout to one store; there is no platform case.
-- ledger_entries: NOT NULL is deliberately NOT applied — platform rows need
-- the null, and the two checks above already constrain it correctly.
-- ---------------------------------------------------------------------------
alter table public.settlements alter column store_id set not null;

-- ---------------------------------------------------------------------------
-- 5. STORE-SCOPED RLS.
--
-- The existing policies scope by seller via is_seller_member(). Under the
-- one-to-one rule that is already correct isolation, so these are REPLACEMENTS
-- that keep the seller path and add the store path, rather than a narrowing
-- that could lock a seller out of their own history mid-migration.
--
-- Writes remain service-role only: none of these tables gains an INSERT or
-- UPDATE policy here, and that is intentional.
-- ---------------------------------------------------------------------------
drop policy if exists settlements_seller_read on public.settlements;
create policy settlements_seller_read on public.settlements
  for select using (
    public.is_admin()
    or public.is_seller_member(seller_id)
    or store_id in (select public.my_finance_store_ids())
  );

drop policy if exists ledger_seller_read on public.ledger_entries;
create policy ledger_seller_read on public.ledger_entries
  for select using (
    public.is_admin()
    or (seller_id is not null and public.is_seller_member(seller_id))
    or (store_id is not null and store_id in (select public.my_finance_store_ids()))
    -- Platform rows (gateway fees) stay admin-only: they are Sakdha's costs,
    -- not any store's, and were never readable by a seller.
  );

drop policy if exists seller_orders_read on public.seller_orders;
create policy seller_orders_read on public.seller_orders
  for select using (
    public.is_admin()
    or public.is_seller_member(seller_id)
    or store_id in (select public.my_finance_store_ids())
    or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
  );

drop policy if exists seller_orders_member_update on public.seller_orders;
create policy seller_orders_member_update on public.seller_orders
  for update using (
    public.is_admin()
    or public.is_seller_member(seller_id)
    or store_id in (select public.my_finance_store_ids())
  )
  with check (
    public.is_admin()
    or public.is_seller_member(seller_id)
    or store_id in (select public.my_finance_store_ids())
  );

-- ---------------------------------------------------------------------------
-- 6. POST-CONDITIONS — assert the acceptance criteria actually hold.
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from (
    select seller_id from public.stores group by seller_id having count(*) > 1
  ) d;
  if n > 0 then raise exception 'post-check: % seller(s) still own multiple stores', n; end if;

  select count(*) into n from public.settlements where store_id is null;
  if n > 0 then raise exception 'post-check: % settlement(s) without store_id', n; end if;

  select count(*) into n
    from public.ledger_entries
   where store_id is null and type <> 'PAYMENT_GATEWAY_FEE';
  if n > 0 then raise exception 'post-check: % non-platform ledger row(s) without store_id', n; end if;

  select count(*) into n from public.ledger_entries where num_nonnulls(store_id, seller_id) = 1;
  if n > 0 then raise exception 'post-check: % half-attributed ledger row(s)', n; end if;

  raise notice '0015 post-checks passed: one-to-one enforced, finance rows fully attributed.';
end $$;
