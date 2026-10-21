-- GENERATED — do not edit. Paste this whole file into the Supabase SQL Editor.
-- Source: supabase/migrations/0013_store_scoped_finance_expand.sql
-- Applies ONLY 0013, atomically. Earlier migrations must already be applied.
-- Regenerate with: npm run bundle -- 0013

begin;

-- ============================================================================
-- SAKDHA COMMERCE — Store-scoped finance, MIGRATION A: EXPAND (0013)
--
-- 0012 moved tenancy to `stores`, but the money still keys off `seller_id`.
-- This closes that gap under one business rule:
--
--     one store  ↔  one seller  ↔  one payout account
--
-- EXPAND is deliberately additive and non-breaking. It adds columns, indexes
-- and a resolver, and nothing else: no NOT NULL, no uniqueness, no composite
-- keys. Every one of those lands in 0015 (ENFORCE), after 0014 (BACKFILL) has
-- proved the data can satisfy them. Running this against the current database
-- cannot fail on existing rows and cannot change application behaviour.
--
-- Already correct, and therefore NOT touched here:
--   • seller_orders.store_id   already exists, NOT NULL, FK to stores (0002)
--   • products.store_id        already exists, NOT NULL (0001)
--   • stores.seller_id         already exists, NOT NULL, FK to sellers (0001)
--
-- Apply with:  npm run bundle -- 0013   then paste supabase/apply_0013.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STORE OWNERSHIP ON THE REMAINING FINANCIAL TABLES
--
-- Nullable on purpose. Historical rows have no store_id until 0014 backfills
-- them, and some ledger rows must stay NULL forever (see below).
-- ---------------------------------------------------------------------------
alter table public.ledger_entries
  add column if not exists store_id uuid references public.stores(id) on delete restrict;

comment on column public.ledger_entries.store_id is
  'Owning store. NULL is meaningful here and not a backfill gap: platform-level '
  'rows (PAYMENT_GATEWAY_FEE) belong to Sakdha, not to any store, and carry '
  'NULL for both store_id and seller_id.';

alter table public.settlements
  add column if not exists store_id uuid references public.stores(id) on delete restrict;

comment on column public.settlements.store_id is
  'The store whose trading this settlement covers. seller_id remains the PAYEE '
  'and the Razorpay beneficiary — the two are not interchangeable.';

-- ---------------------------------------------------------------------------
-- INDEXES for store-scoped reads.
--
-- seller_orders.store_id has been NOT NULL since 0002 but was never indexed —
-- every store-scoped order query would have seq-scanned.
-- ---------------------------------------------------------------------------
create index if not exists seller_orders_store_idx
  on public.seller_orders(store_id);

create index if not exists ledger_entries_store_idx
  on public.ledger_entries(store_id);

-- Mirrors ledger_entries_seller_created_idx (0010): the settlement fold reads
-- one store's ledger for one month, so the scan should grow with that store's
-- volume rather than with total platform volume.
create index if not exists ledger_entries_store_created_idx
  on public.ledger_entries(store_id, created_at);

create index if not exists settlements_store_idx
  on public.settlements(store_id);

-- ---------------------------------------------------------------------------
-- RESOLVER — the single authoritative "which store does this seller trade as?"
--
-- Every backfill and every write path goes through this rather than inlining
-- the join, so there is exactly one definition of the mapping to audit. It is
-- strict on purpose: under the one-to-one rule a seller with two stores is a
-- broken invariant, and returning an arbitrary one would silently misattribute
-- money. `strict` makes a NULL seller return NULL rather than scanning.
-- ---------------------------------------------------------------------------
create or replace function public.store_id_for_seller(p_seller_id uuid)
returns uuid language sql stable strict security definer set search_path = public as $$
  select s.id
    from public.stores s
   where s.seller_id = p_seller_id
   -- Deterministic if the one-to-one rule is ever violated: oldest store wins,
   -- and 0015's unique constraint makes the situation unreachable anyway.
   order by s.created_at asc
   limit 1;
$$;

comment on function public.store_id_for_seller(uuid) is
  'Authoritative seller -> store mapping under the one-store-per-seller rule. '
  'Used by backfills and write paths; never resolve a store from client input.';

grant execute on function public.store_id_for_seller(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- A store-scoped sibling of my_seller_id(), for the RLS switch in 0015.
--
-- Defined here so 0015 contains only constraint and policy changes. Returns
-- the stores the caller may act for, via store_members (0012) OR via the
-- legacy seller relationship, so a seller who never got a store_members row
-- does not lose access mid-migration.
-- ---------------------------------------------------------------------------
create or replace function public.my_finance_store_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select store_id from public.store_members where profile_id = auth.uid()
  union
  select s.id from public.stores s where s.seller_id = public.my_seller_id()
$$;

comment on function public.my_finance_store_ids() is
  'Stores the caller may see financial data for. Unions store_members (0012) '
  'with the legacy seller mapping so neither path is cut off during migration.';

grant execute on function public.my_finance_store_ids() to anon, authenticated;

commit;
