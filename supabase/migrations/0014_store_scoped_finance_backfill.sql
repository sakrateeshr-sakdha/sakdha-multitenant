-- ============================================================================
-- SAKDHA COMMERCE — Store-scoped finance, MIGRATION B: BACKFILL (0014)
--
-- Populates store_id on historical financial rows, from VERIFIED relationships
-- only. Requires 0013.
--
-- Resolution order, most authoritative first. Nothing is resolved from a
-- current request, a subdomain, or a present-day owner association — only from
-- the row's own recorded relationships:
--
--   ledger_entries  → seller_order.store_id      (the order's own record)
--                   → order's single seller_order (for order-scoped rows)
--                   → store_id_for_seller(seller_id)  (for SETTLEMENT rows)
--   settlements     → store_id_for_seller(seller_id)
--
-- Idempotent: every statement is guarded by `where store_id is null`, so a
-- re-run touches nothing already resolved.
--
-- ⚠ CONTAINS ONE FINANCIALLY SIGNIFICANT CORRECTION — see section 3. Read it
--   before applying. It changes what the next settlement run will pay.
--
-- Apply with:  npm run bundle -- 0014   then paste supabase/apply_0014.sql
-- (the generated file supplies the begin/commit — do not add one here)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. PRE-FLIGHT — refuse to run if the one-to-one rule is already violated.
--
-- Backfilling store_id from a seller that owns two stores would misattribute
-- money with no way to tell afterwards which rows were guessed. Better to stop.
-- ---------------------------------------------------------------------------
do $$
declare
  multi_store integer;
  orphan_store integer;
begin
  select count(*) into multi_store from (
    select seller_id from public.stores group by seller_id having count(*) > 1
  ) d;
  if multi_store > 0 then
    raise exception
      'Cannot backfill: % seller(s) own more than one store. The one-store-per-seller rule does not hold; resolve this before running 0014.',
      multi_store;
  end if;

  select count(*) into orphan_store
    from public.stores s
   where s.seller_id is null
      or not exists (select 1 from public.sellers x where x.id = s.seller_id);
  if orphan_store > 0 then
    raise exception
      'Cannot backfill: % store(s) have a missing or unresolvable seller.',
      orphan_store;
  end if;

  raise notice 'Pre-flight OK: store<->seller mapping is one-to-one.';
end $$;

-- ---------------------------------------------------------------------------
-- 1. SETTLEMENTS — resolve via the payee seller.
-- ---------------------------------------------------------------------------
update public.settlements s
   set store_id = public.store_id_for_seller(s.seller_id)
 where s.store_id is null
   and s.seller_id is not null;

-- ---------------------------------------------------------------------------
-- 2. LEDGER ENTRIES — most authoritative link first.
--
-- 2a. Rows tied to a seller_order inherit that order's OWN store. This is the
--     strongest link available: it is what was recorded at the time of sale,
--     not what the mapping looks like today.
-- ---------------------------------------------------------------------------
update public.ledger_entries le
   set store_id = so.store_id
  from public.seller_orders so
 where le.store_id is null
   and le.seller_order_id = so.id;

-- 2b. Rows with an order but no seller_order: only safe when the parent order
--     fanned out to exactly ONE seller_order. A multi-seller order cannot be
--     attributed to a single store, and guessing would be fabrication.
update public.ledger_entries le
   set store_id = sole.store_id
  from (
    select order_id, min(store_id::text)::uuid as store_id
      from public.seller_orders
     group by order_id
    having count(distinct store_id) = 1
  ) sole
 where le.store_id is null
   and le.seller_order_id is null
   and le.order_id = sole.order_id
   -- PAYMENT_GATEWAY_FEE is charged to Sakdha on the whole payment and has no
   -- store, even on a single-seller order. It must stay NULL.
   and le.type <> 'PAYMENT_GATEWAY_FEE';

-- 2c. SETTLEMENT rows carry a seller but neither an order nor a seller_order.
--     The seller mapping is the only link, and it is authoritative under the
--     one-to-one rule enforced by the pre-flight check above.
update public.ledger_entries le
   set store_id = public.store_id_for_seller(le.seller_id)
 where le.store_id is null
   and le.seller_id is not null
   and le.order_id is null
   and le.seller_order_id is null;

-- ---------------------------------------------------------------------------
-- 3. ⚠ REFUND ATTRIBUTION — a pre-existing correctness bug, not a new feature.
--
-- The refund webhook writes REFUND ledger rows WITHOUT seller_id (it sets
-- order_id, seller_order_id, type, amount, direction, ref_json and nothing
-- else). Two consumers then drop those rows on the floor:
--
--   settlePeriod()      skips every row where seller_id is null
--   getSellerEarnings() filters .eq("seller_id", …), which null never matches
--
-- The effect is that refunds have never reduced a seller's settlement:
-- netPayable = max(0, earned − refunds) can only ever see refunds = 0.
-- Sellers are overpaid by the full refunded amount.
--
-- These rows DO carry seller_order_id, so the correct owner is recoverable
-- from the row's own recorded relationship — this derives the attribution that
-- should always have been written. It does not invent one.
--
-- APPLYING THIS CHANGES MONEY. Re-settling an affected period will pay less
-- than it would have before. Verify the reconciliation report in section 5
-- against expectations before trusting a settlement run.
-- ---------------------------------------------------------------------------
update public.ledger_entries le
   set seller_id = so.seller_id
  from public.seller_orders so
 where le.seller_id is null
   and le.seller_order_id = so.id
   -- Scoped to refund rows: platform rows legitimately have no seller and must
   -- not be swept up by this.
   and le.type in ('REFUND', 'REFUND_ADJUSTMENT');

-- Those rows can now resolve a store too.
update public.ledger_entries le
   set store_id = so.store_id
  from public.seller_orders so
 where le.store_id is null
   and le.seller_order_id = so.id;

-- ---------------------------------------------------------------------------
-- 4. CONSISTENCY CHECK — did anything land on a store/seller pair that
--    disagrees? If so the backfill is wrong and must not be committed.
-- ---------------------------------------------------------------------------
do $$
declare bad integer;
begin
  select count(*) into bad
    from public.ledger_entries le
    join public.stores s on s.id = le.store_id
   where le.seller_id is not null
     and s.seller_id <> le.seller_id;
  if bad > 0 then
    raise exception 'Backfill produced % ledger row(s) whose store and seller disagree.', bad;
  end if;

  select count(*) into bad
    from public.settlements st
    join public.stores s on s.id = st.store_id
   where s.seller_id <> st.seller_id;
  if bad > 0 then
    raise exception 'Backfill produced % settlement row(s) whose store and seller disagree.', bad;
  end if;

  select count(*) into bad
    from public.seller_orders so
    join public.stores s on s.id = so.store_id
   where s.seller_id <> so.seller_id;
  if bad > 0 then
    raise exception 'Found % PRE-EXISTING seller_order row(s) whose store and seller disagree.', bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RECONCILIATION REPORT — printed as notices, so the paste output is the
--    validation record. Nothing here modifies data.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  total integer; resolved integer; unresolved integer;
begin
  raise notice '--- 0014 BACKFILL RECONCILIATION -------------------------';

  select count(*), count(store_id) into total, resolved from public.seller_orders;
  raise notice 'seller_orders   : % rows, % with store_id (pre-existing column)', total, resolved;

  select count(*), count(store_id) into total, resolved from public.settlements;
  raise notice 'settlements     : % rows, % with store_id', total, resolved;

  select count(*), count(store_id) into total, resolved from public.ledger_entries;
  unresolved := total - resolved;
  raise notice 'ledger_entries  : % rows, % with store_id, % without', total, resolved, unresolved;

  -- Expected NULLs are platform rows only. Anything else needs review.
  for r in
    select type, count(*) as n
      from public.ledger_entries
     where store_id is null
     group by type
     order by type
  loop
    if r.type = 'PAYMENT_GATEWAY_FEE' then
      raise notice '  unresolved % x %  (EXPECTED — platform-level, no store)', r.n, r.type;
    else
      raise notice '  unresolved % x %  *** NEEDS REVIEW ***', r.n, r.type;
    end if;
  end loop;

  select count(*) into unresolved
    from public.ledger_entries
   where seller_id is null and type not in ('PAYMENT_GATEWAY_FEE');
  raise notice 'ledger rows still missing seller_id (excl. platform): %', unresolved;

  raise notice '--- per-store ledger totals (paise) ----------------------';
  for r in
    select coalesce(s.slug, '(platform)') as slug,
           le.type,
           sum(le.amount) as amount,
           count(*) as n
      from public.ledger_entries le
      left join public.stores s on s.id = le.store_id
     group by 1, 2
     order by 1, 2
  loop
    raise notice '  % | % | % rows | %', rpad(r.slug, 18), rpad(r.type, 20), r.n, r.amount;
  end loop;

  raise notice '--- end ---------------------------------------------------';
end $$;
