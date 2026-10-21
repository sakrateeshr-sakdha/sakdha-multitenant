-- ============================================================================
-- ⚠ DO NOT RUN THIS AGAINST THE EXISTING DATABASE. ⚠
--
-- Already applied on 2026-10-05. Its `create table` statements are unguarded
-- (no `if not exists`), so re-running fails immediately with
--   ERROR 42P07: relation "profiles" already exists
-- and tells you nothing about what is actually deployed.
--
-- To apply a NEW migration:  npm run bundle -- 00NN
-- then paste supabase/apply_00NN.sql — one migration, wrapped in a transaction.
-- ============================================================================

-- ============================================================================
-- SAKDHA MARKETPLACE — FULL SCHEMA BUNDLE
--
-- This is migrations 0001..0005 concatenated for a ONE-SHOT paste into the
-- Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- • Run this ONCE, on a FRESH project. It is NOT idempotent: re-running will
--   fail on `create table` / `create policy` and would duplicate seed rows.
-- • Everything is wrapped in a single transaction, so any failure rolls the
--   whole thing back and leaves the database untouched.
-- • Generated from supabase/migrations/*.sql — those files stay the source of
--   truth. Do not edit this bundle; regenerate it instead.
--
-- Contents:
--   0001_schema.sql          identity, stores, catalog, then RLS helper fns
--   0002_orders_payments.sql cart, orders, shipments, payments, ledger, returns
--   0003_config_trust.sql    commission/shipping/coupons, reviews, ops tables
--   0004_rls.sql             enable RLS everywhere + all policies
--   0005_seed_triggers.sql   auth trigger, default 2% commission, categories
-- ============================================================================

begin;



-- ####################################################################
-- ## FILE: 0001_schema.sql
-- ####################################################################

-- ============================================================================
-- SAKDHA MARKETPLACE — Core schema (0001)
--
-- Conventions:
--   • Money is INTEGER PAISE (bigint). Never float.
--   • Timestamps are timestamptz, default now().
--   • Statuses are text + CHECK (easy to extend without ALTER TYPE).
--   • Every seller-scoped table carries seller_id for RLS.
-- ============================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists pg_trgm;        -- fuzzy search (typo tolerance)

-- ===========================================================================
-- IDENTITY & STORES
-- ===========================================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'customer'
              check (role in ('customer','seller','seller_staff','admin')),
  full_name   text,
  email       text,
  phone       text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table public.sellers (
  id                       uuid primary key default gen_random_uuid(),
  owner_profile_id         uuid not null references public.profiles(id) on delete restrict,
  legal_name               text not null,
  display_name             text,
  status                   text not null default 'DRAFT'
      check (status in ('DRAFT','PENDING_VERIFICATION','PENDING_APPROVAL','ACTIVE','SUSPENDED','REJECTED')),
  risk_level               text not null default 'GOOD'
      check (risk_level in ('EXCELLENT','GOOD','NEEDS_IMPROVEMENT','AT_RISK','SUSPENDED')),
  razorpay_account_id      text,         -- Route linked account (acc_xxx)
  razorpay_product_config  text,         -- Route product configuration id
  kyc_json                 jsonb not null default '{}',
  onboarding_step          text not null default 'account',
  created_at               timestamptz not null default now()
);
create index on public.sellers(owner_profile_id);
create index on public.sellers(status);

create table public.stores (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references public.sellers(id) on delete cascade,
  slug           text not null unique,
  name           text not null,
  logo_url       text,
  cover_url      text,
  description    text,
  city           text,
  state          text,
  pincode        text,
  social_json    jsonb not null default '{}',
  return_policy  text,
  shipping_info  text,
  rating_avg     numeric(3,2) not null default 0,
  rating_count   integer not null default 0,
  product_count  integer not null default 0,
  is_indexable   boolean not null default false,
  created_at     timestamptz not null default now()
);
create index on public.stores(seller_id);
create index on public.stores(city);

create table public.seller_staff (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references public.sellers(id) on delete cascade,
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  allowed_modules  text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (seller_id, profile_id)
);
create index on public.seller_staff(profile_id);

create table public.seller_bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null references public.sellers(id) on delete cascade,
  account_name        text not null,
  account_number_enc  text not null,       -- store encrypted; never raw
  ifsc                text not null,
  verified            boolean not null default false,
  created_at          timestamptz not null default now()
);
create index on public.seller_bank_accounts(seller_id);

-- ===========================================================================
-- CATALOG
-- ===========================================================================
create table public.categories (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  parent_id        uuid references public.categories(id) on delete set null,
  name             text not null,
  seo_title        text,
  seo_description  text,
  intro_md         text,
  position         integer not null default 0,
  is_indexable     boolean not null default true,
  created_at       timestamptz not null default now()
);
create index on public.categories(parent_id);

create table public.brands (
  id    uuid primary key default gen_random_uuid(),
  slug  text not null unique,
  name  text not null
);

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.stores(id) on delete cascade,
  seller_id         uuid not null references public.sellers(id) on delete cascade,
  slug              text not null unique,
  name              text not null,
  short_description text,
  description       text,
  category_id       uuid references public.categories(id) on delete set null,
  brand_id          uuid references public.brands(id) on delete set null,
  price             bigint not null check (price >= 0),           -- paise
  compare_at_price  bigint check (compare_at_price >= 0),
  gender            text,   -- women | men | kids | unisex
  age_group         text,
  fabric            text,
  pattern           text,
  fit               text,
  occasion          text,
  wash_care         text,
  weight_grams      integer,
  dims_json         jsonb not null default '{}',
  tags              text[] not null default '{}',
  status            text not null default 'DRAFT'
      check (status in ('DRAFT','ACTIVE','SUSPENDED','ARCHIVED')),
  seo_title         text,
  seo_description   text,
  seo_keywords      text,
  canonical_url     text,
  rating_avg        numeric(3,2) not null default 0,
  rating_count      integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.products(store_id);
create index on public.products(seller_id);
create index on public.products(category_id);
create index on public.products(status);
create index on public.products using gin (name gin_trgm_ops);

create table public.product_media (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  url         text not null,
  type        text not null default 'image' check (type in ('image','video')),
  position    integer not null default 0
);
create index on public.product_media(product_id);

create table public.product_options (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  name        text not null,          -- e.g. "Size", "Color"
  position    integer not null default 0
);
create index on public.product_options(product_id);

create table public.product_variants (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.products(id) on delete cascade,
  sku                text,
  option_values_json jsonb not null default '{}',   -- {"Size":"M","Color":"Blue"}
  price_override     bigint check (price_override >= 0),
  inventory_qty      integer not null default 0 check (inventory_qty >= 0),
  reserved_qty       integer not null default 0 check (reserved_qty >= 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);
create index on public.product_variants(product_id);

-- 301 redirect map for changed product slugs.
create table public.product_slug_redirects (
  old_slug    text primary key,
  product_id  uuid not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- ===========================================================================
-- RLS HELPER FUNCTIONS (SECURITY DEFINER: bypass RLS, never recurse)
--
-- These MUST be declared after the tables they read: Postgres validates the
-- body of a `language sql` function against the catalog at CREATE time, so
-- declaring them earlier fails with `relation "public.profiles" does not exist`.
-- ===========================================================================
create or replace function public.my_role()
returns text language sql security definer stable set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- The seller_id the current user belongs to (as owner OR active staff).
create or replace function public.my_seller_id()
returns uuid language sql security definer stable set search_path = public as $$
  select coalesce(
    (select id from public.sellers where owner_profile_id = auth.uid()),
    (select seller_id from public.seller_staff where profile_id = auth.uid())
  );
$$;

create or replace function public.is_seller_member(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select target is not null and target = public.my_seller_id();
$$;


-- ####################################################################
-- ## FILE: 0002_orders_payments.sql
-- ####################################################################

-- ============================================================================
-- SAKDHA MARKETPLACE — Cart, Orders, Payments, Ledger, Returns (0002)
-- ============================================================================

-- ===========================================================================
-- CART (multi-store)
-- ===========================================================================
create table public.carts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (customer_id)
);

create table public.cart_items (
  id                   uuid primary key default gen_random_uuid(),
  cart_id              uuid not null references public.carts(id) on delete cascade,
  product_id           uuid not null references public.products(id) on delete cascade,
  variant_id           uuid references public.product_variants(id) on delete set null,
  seller_id            uuid not null references public.sellers(id) on delete cascade,
  store_id             uuid not null references public.stores(id) on delete cascade,
  qty                  integer not null check (qty > 0),
  unit_price_snapshot  bigint not null check (unit_price_snapshot >= 0),
  created_at           timestamptz not null default now()
);
create index on public.cart_items(cart_id);

-- ===========================================================================
-- ORDERS — parent → seller_orders → order_items → shipments
-- ===========================================================================
create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  order_number         text not null unique,
  customer_id          uuid not null references public.profiles(id) on delete restrict,
  subtotal             bigint not null default 0,   -- product value, paise
  discount_total       bigint not null default 0,
  shipping_total       bigint not null default 0,
  tax_total            bigint not null default 0,
  commission_total     bigint not null default 0,   -- Sakdha's cut
  grand_total          bigint not null default 0,   -- customer payable
  payment_status       text not null default 'PENDING_PAYMENT'
      check (payment_status in ('PENDING_PAYMENT','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
  order_status         text not null default 'PENDING_PAYMENT'
      check (order_status in ('PENDING_PAYMENT','PAID','PARTIALLY_PROCESSING','PROCESSING',
             'PARTIALLY_SHIPPED','SHIPPED','PARTIALLY_DELIVERED','DELIVERED','CANCELLED',
             'PARTIALLY_CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  razorpay_order_id    text,
  razorpay_payment_id  text,
  shipping_address_json jsonb not null default '{}',
  created_at           timestamptz not null default now()
);
create index on public.orders(customer_id);
create index on public.orders(razorpay_order_id);

create table public.seller_orders (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  seller_id          uuid not null references public.sellers(id) on delete restrict,
  store_id           uuid not null references public.stores(id) on delete restrict,
  subtotal           bigint not null default 0,
  discount           bigint not null default 0,
  shipping           bigint not null default 0,
  tax                bigint not null default 0,
  commission         bigint not null default 0,
  seller_payable     bigint not null default 0,
  status             text not null default 'NEW'
      check (status in ('NEW','ACCEPTED','PROCESSING','READY_TO_SHIP','SHIPPED',
             'OUT_FOR_DELIVERY','DELIVERED','CANCELLED','RETURN_REQUESTED','RETURNED','REFUNDED')),
  dispatch_deadline  timestamptz,
  razorpay_transfer_id text,
  created_at         timestamptz not null default now()
);
create index on public.seller_orders(order_id);
create index on public.seller_orders(seller_id);

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  seller_order_id  uuid not null references public.seller_orders(id) on delete cascade,
  order_id         uuid not null references public.orders(id) on delete cascade,
  product_id       uuid references public.products(id) on delete set null,
  variant_id       uuid references public.product_variants(id) on delete set null,
  name_snapshot    text not null,
  sku_snapshot     text,
  qty              integer not null check (qty > 0),
  unit_price       bigint not null check (unit_price >= 0),
  line_total       bigint not null check (line_total >= 0)
);
create index on public.order_items(seller_order_id);

create table public.shipments (
  id                      uuid primary key default gen_random_uuid(),
  seller_order_id         uuid not null references public.seller_orders(id) on delete cascade,
  carrier                 text,
  tracking_number         text,
  shipping_method         text,
  status                  text not null default 'PROCESSING'
      check (status in ('PROCESSING','READY_TO_SHIP','SHIPPED','OUT_FOR_DELIVERY','DELIVERED','RETURNED')),
  estimated_delivery_from date,
  estimated_delivery_to   date,
  shipped_at              timestamptz,
  delivered_at            timestamptz,
  created_at              timestamptz not null default now()
);
create index on public.shipments(seller_order_id);

create table public.shipment_items (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    uuid not null references public.shipments(id) on delete cascade,
  order_item_id  uuid not null references public.order_items(id) on delete cascade,
  qty            integer not null check (qty > 0)
);

-- ===========================================================================
-- PAYMENTS, SPLITS, SETTLEMENTS, LEDGER
-- ===========================================================================
create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders(id) on delete restrict,
  razorpay_payment_id  text unique,
  amount               bigint not null,
  status               text not null,       -- authorized | captured | failed | refunded
  method               text,
  captured_at          timestamptz,
  raw_event_json       jsonb not null default '{}',
  created_at           timestamptz not null default now()
);

create table public.payment_splits (
  id                   uuid primary key default gen_random_uuid(),
  seller_order_id      uuid not null references public.seller_orders(id) on delete cascade,
  razorpay_transfer_id text unique,
  amount               bigint not null,
  commission           bigint not null default 0,
  status               text not null default 'pending',
  settled_at           timestamptz,
  created_at           timestamptz not null default now()
);

create table public.settlements (
  id                     uuid primary key default gen_random_uuid(),
  seller_id              uuid not null references public.sellers(id) on delete restrict,
  period                 text not null,
  gross                  bigint not null default 0,
  commission             bigint not null default 0,
  refunds                bigint not null default 0,
  net_payable            bigint not null default 0,
  razorpay_settlement_id text,
  status                 text not null default 'pending',
  created_at             timestamptz not null default now()
);
create index on public.settlements(seller_id);

-- The source of financial truth. Every rupee movement is a row here.
create table public.ledger_entries (
  id               uuid primary key default gen_random_uuid(),
  type             text not null
      check (type in ('PRODUCT_SALE','SHIPPING','DISCOUNT','SAKDHA_COMMISSION',
             'PAYMENT_GATEWAY_FEE','SELLER_PAYABLE','REFUND','REFUND_ADJUSTMENT','SETTLEMENT')),
  order_id         uuid references public.orders(id) on delete set null,
  seller_order_id  uuid references public.seller_orders(id) on delete set null,
  seller_id        uuid references public.sellers(id) on delete set null,
  amount           bigint not null,
  direction        text not null check (direction in ('debit','credit')),
  ref_json         jsonb not null default '{}',
  created_at       timestamptz not null default now()
);
create index on public.ledger_entries(order_id);
create index on public.ledger_entries(seller_id);

-- ===========================================================================
-- RETURNS & REFUNDS (seller-order / item level)
-- ===========================================================================
create table public.return_requests (
  id               uuid primary key default gen_random_uuid(),
  seller_order_id  uuid not null references public.seller_orders(id) on delete cascade,
  customer_id      uuid not null references public.profiles(id) on delete cascade,
  reason           text,
  status           text not null default 'REQUESTED'
      check (status in ('REQUESTED','APPROVED','REJECTED','RECEIVED','REFUNDED')),
  created_at       timestamptz not null default now()
);

create table public.return_items (
  id                 uuid primary key default gen_random_uuid(),
  return_request_id  uuid not null references public.return_requests(id) on delete cascade,
  order_item_id      uuid not null references public.order_items(id) on delete cascade,
  qty                integer not null check (qty > 0),
  refund_amount      bigint not null default 0
);

create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  seller_order_id    uuid references public.seller_orders(id) on delete set null,
  razorpay_refund_id text unique,
  amount             bigint not null,
  status             text not null default 'pending',
  reason             text,
  created_at         timestamptz not null default now()
);

-- ===========================================================================
-- WEBHOOK IDEMPOTENCY — a processed event is never replayed.
-- ===========================================================================
create table public.webhook_events (
  id            text primary key,         -- Razorpay event id
  event_type    text not null,
  processed_at  timestamptz not null default now()
);


-- ####################################################################
-- ## FILE: 0003_config_trust.sql
-- ####################################################################

-- ============================================================================
-- SAKDHA MARKETPLACE — Commerce config, reviews, performance, ops (0003)
-- ============================================================================

-- ===========================================================================
-- COMMERCE CONFIG (commission, shipping, coupons)
-- ===========================================================================
create table public.commission_rules (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  percentage   numeric(5,2) not null default 2.00,
  fixed_amount bigint not null default 0,
  applies_to   text not null default 'PRODUCT_SUBTOTAL'
      check (applies_to in ('PRODUCT_SUBTOTAL','ORDER_TOTAL','SHIPPING')),
  category_id  uuid references public.categories(id) on delete cascade,
  seller_id    uuid references public.sellers(id) on delete cascade,
  active       boolean not null default true,
  valid_from   timestamptz not null default now(),
  valid_until  timestamptz,
  created_at   timestamptz not null default now()
);

create table public.shipping_rules (
  id                   uuid primary key default gen_random_uuid(),
  seller_id            uuid not null references public.sellers(id) on delete cascade,
  type                 text not null default 'FREE'
      check (type in ('FREE','FLAT','FREE_ABOVE')),
  flat_fee             bigint not null default 0,
  free_above_threshold bigint,
  dispatch_sla_hours   integer not null default 48,
  created_at           timestamptz not null default now(),
  unique (seller_id)
);

create table public.coupons (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  scope      text not null check (scope in ('MARKETPLACE','STORE','PRODUCT')),
  funded_by  text not null check (funded_by in ('SAKDHA','SELLER')),
  seller_id  uuid references public.sellers(id) on delete cascade,
  type       text not null check (type in ('PERCENT','FIXED')),
  value      bigint not null,                 -- percent*100 or paise
  min_order  bigint not null default 0,
  max_discount bigint,
  starts_at  timestamptz,
  ends_at    timestamptz,
  usage_limit integer,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.coupons(id) on delete cascade,
  order_id    uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  amount      bigint not null,
  created_at  timestamptz not null default now()
);

-- ===========================================================================
-- REVIEWS (verified-purchase only), PERFORMANCE
-- ===========================================================================
create table public.reviews (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid references public.products(id) on delete cascade,
  store_id          uuid references public.stores(id) on delete cascade,
  customer_id       uuid not null references public.profiles(id) on delete cascade,
  order_item_id     uuid references public.order_items(id) on delete set null,
  rating            integer not null check (rating between 1 and 5),
  body              text,
  images_json       jsonb not null default '[]',
  verified_purchase boolean not null default false,
  seller_response   text,
  status            text not null default 'PENDING'
      check (status in ('PENDING','APPROVED','REJECTED')),
  created_at        timestamptz not null default now()
);
create index on public.reviews(product_id);

create table public.seller_performance (
  seller_id          uuid primary key references public.sellers(id) on delete cascade,
  total_orders       integer not null default 0,
  on_time_rate       numeric(5,2) not null default 0,
  late_rate          numeric(5,2) not null default 0,
  cancellation_rate  numeric(5,2) not null default 0,
  return_rate        numeric(5,2) not null default 0,
  refund_rate        numeric(5,2) not null default 0,
  rating_avg         numeric(3,2) not null default 0,
  order_defect_rate  numeric(5,2) not null default 0,
  updated_at         timestamptz not null default now()
);

-- ===========================================================================
-- OPS: notifications, analytics, audit, wishlist, addresses, saved stores
-- ===========================================================================
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  audience      text not null check (audience in ('customer','seller','admin')),
  type          text not null,
  payload_json  jsonb not null default '{}',
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index on public.notifications(recipient_id);

create table public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  type        text not null,
  customer_id uuid references public.profiles(id) on delete set null,
  seller_id   uuid references public.sellers(id) on delete set null,
  product_id  uuid references public.products(id) on delete set null,
  store_id    uuid references public.stores(id) on delete set null,
  session_id  text,
  payload_json jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index on public.analytics_events(type);

create table public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  diff_json  jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  phone       text not null,
  line1       text not null,
  line2       text,
  city        text not null,
  state       text not null,
  pincode     text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on public.addresses(customer_id);

create table public.wishlist_items (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (customer_id, product_id)
);

create table public.saved_stores (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (customer_id, store_id)
);


-- ####################################################################
-- ## FILE: 0004_rls.sql
-- ####################################################################

-- ============================================================================
-- SAKDHA MARKETPLACE — Row Level Security (0004)
--
-- Model:
--   • Public (anon) can READ the live catalog (active products, stores,
--     categories, approved reviews) — this is what Google and shoppers see.
--   • A seller member can manage ONLY their own seller's rows.
--   • A customer can access ONLY their own cart/orders/addresses/etc.
--   • Financial tables (payments, splits, settlements, ledger, refunds,
--     webhook_events) have RLS ENABLED but NO permissive policy → only the
--     service-role key (which bypasses RLS) can touch them. All money writes go
--     through audited server routes.
--   • Admin (profiles.role='admin') can read/write everything via is_admin().
-- ============================================================================

-- Enable RLS everywhere.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------------
create policy profiles_self_read on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_self_insert on public.profiles
  for insert with check (id = auth.uid());
create policy profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- SELLERS (private to member + admin)
-- ---------------------------------------------------------------------------
create policy sellers_member_read on public.sellers
  for select using (id = public.my_seller_id() or public.is_admin());
create policy sellers_owner_insert on public.sellers
  for insert with check (owner_profile_id = auth.uid());
create policy sellers_member_update on public.sellers
  for update using (id = public.my_seller_id() or public.is_admin())
  with check (id = public.my_seller_id() or public.is_admin());
create policy sellers_admin_delete on public.sellers
  for delete using (public.is_admin());

-- ---------------------------------------------------------------------------
-- STORES (public read; member/admin write)
-- ---------------------------------------------------------------------------
create policy stores_public_read on public.stores for select using (true);
create policy stores_member_write on public.stores
  for all using (public.is_seller_member(seller_id) or public.is_admin())
  with check (public.is_seller_member(seller_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- SELLER STAFF / BANK (member + admin only)
-- ---------------------------------------------------------------------------
create policy seller_staff_member on public.seller_staff
  for all using (public.is_seller_member(seller_id) or public.is_admin())
  with check (public.is_seller_member(seller_id) or public.is_admin());
create policy seller_bank_member on public.seller_bank_accounts
  for all using (public.is_seller_member(seller_id) or public.is_admin())
  with check (public.is_seller_member(seller_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- CATALOG: categories & brands (public read, admin write)
-- ---------------------------------------------------------------------------
create policy categories_public_read on public.categories for select using (true);
create policy categories_admin_write on public.categories
  for all using (public.is_admin()) with check (public.is_admin());
create policy brands_public_read on public.brands for select using (true);
create policy brands_admin_write on public.brands
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- PRODUCTS (public read ACTIVE; member sees/manages own)
-- ---------------------------------------------------------------------------
create policy products_public_read on public.products
  for select using (status = 'ACTIVE' or public.is_seller_member(seller_id) or public.is_admin());
create policy products_member_write on public.products
  for all using (public.is_seller_member(seller_id) or public.is_admin())
  with check (public.is_seller_member(seller_id) or public.is_admin());

-- Child catalog tables: readable when the parent product is visible; writable
-- by the owning seller member / admin.
create policy product_media_read on public.product_media
  for select using (exists (
    select 1 from public.products p where p.id = product_id
    and (p.status = 'ACTIVE' or public.is_seller_member(p.seller_id) or public.is_admin())));
create policy product_media_write on public.product_media
  for all using (exists (select 1 from public.products p where p.id = product_id
    and (public.is_seller_member(p.seller_id) or public.is_admin())))
  with check (exists (select 1 from public.products p where p.id = product_id
    and (public.is_seller_member(p.seller_id) or public.is_admin())));

create policy product_options_read on public.product_options
  for select using (exists (select 1 from public.products p where p.id = product_id
    and (p.status = 'ACTIVE' or public.is_seller_member(p.seller_id) or public.is_admin())));
create policy product_options_write on public.product_options
  for all using (exists (select 1 from public.products p where p.id = product_id
    and (public.is_seller_member(p.seller_id) or public.is_admin())))
  with check (exists (select 1 from public.products p where p.id = product_id
    and (public.is_seller_member(p.seller_id) or public.is_admin())));

create policy product_variants_read on public.product_variants
  for select using (exists (select 1 from public.products p where p.id = product_id
    and (p.status = 'ACTIVE' or public.is_seller_member(p.seller_id) or public.is_admin())));
create policy product_variants_write on public.product_variants
  for all using (exists (select 1 from public.products p where p.id = product_id
    and (public.is_seller_member(p.seller_id) or public.is_admin())))
  with check (exists (select 1 from public.products p where p.id = product_id
    and (public.is_seller_member(p.seller_id) or public.is_admin())));

-- ---------------------------------------------------------------------------
-- CART (customer owns)
-- ---------------------------------------------------------------------------
create policy carts_owner on public.carts
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy cart_items_owner on public.cart_items
  for all using (exists (select 1 from public.carts c where c.id = cart_id and c.customer_id = auth.uid()))
  with check (exists (select 1 from public.carts c where c.id = cart_id and c.customer_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- ORDERS (customer owns parent; seller sees their seller_orders; admin all)
-- Order/payment WRITES happen via service role (webhooks/checkout routes).
-- ---------------------------------------------------------------------------
create policy orders_customer_read on public.orders
  for select using (customer_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.seller_orders so
               where so.order_id = id and public.is_seller_member(so.seller_id)));

create policy seller_orders_read on public.seller_orders
  for select using (public.is_seller_member(seller_id) or public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
-- Seller may advance the status of their own seller_order (accept/ship/etc).
create policy seller_orders_member_update on public.seller_orders
  for update using (public.is_seller_member(seller_id) or public.is_admin())
  with check (public.is_seller_member(seller_id) or public.is_admin());

create policy order_items_read on public.order_items
  for select using (public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
    or exists (select 1 from public.seller_orders so where so.id = seller_order_id and public.is_seller_member(so.seller_id)));

create policy shipments_read on public.shipments
  for select using (public.is_admin()
    or exists (select 1 from public.seller_orders so where so.id = seller_order_id
               and (public.is_seller_member(so.seller_id)
                    or exists (select 1 from public.orders o where o.id = so.order_id and o.customer_id = auth.uid()))));
create policy shipments_member_write on public.shipments
  for all using (exists (select 1 from public.seller_orders so where so.id = seller_order_id
                 and (public.is_seller_member(so.seller_id) or public.is_admin())))
  with check (exists (select 1 from public.seller_orders so where so.id = seller_order_id
                 and (public.is_seller_member(so.seller_id) or public.is_admin())));
create policy shipment_items_read on public.shipment_items
  for select using (exists (select 1 from public.shipments s where s.id = shipment_id));

-- ---------------------------------------------------------------------------
-- FINANCIAL (seller may READ own; customer READ own payments; writes service-role)
-- ---------------------------------------------------------------------------
create policy payments_read on public.payments
  for select using (public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy payment_splits_seller_read on public.payment_splits
  for select using (public.is_admin()
    or exists (select 1 from public.seller_orders so where so.id = seller_order_id and public.is_seller_member(so.seller_id)));
create policy settlements_seller_read on public.settlements
  for select using (public.is_seller_member(seller_id) or public.is_admin());
create policy ledger_seller_read on public.ledger_entries
  for select using (public.is_admin() or (seller_id is not null and public.is_seller_member(seller_id)));
create policy refunds_read on public.refunds
  for select using (public.is_admin()
    or exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
    or exists (select 1 from public.seller_orders so where so.id = seller_order_id and public.is_seller_member(so.seller_id)));
-- NOTE: no INSERT/UPDATE policies on the five tables above → service-role only.
-- webhook_events & product_slug_redirects also have no policy (service-role only).

-- ---------------------------------------------------------------------------
-- RETURNS (customer own; seller own; admin)
-- ---------------------------------------------------------------------------
create policy return_requests_rw on public.return_requests
  for all using (customer_id = auth.uid() or public.is_admin()
      or exists (select 1 from public.seller_orders so where so.id = seller_order_id and public.is_seller_member(so.seller_id)))
  with check (customer_id = auth.uid() or public.is_admin()
      or exists (select 1 from public.seller_orders so where so.id = seller_order_id and public.is_seller_member(so.seller_id)));
create policy return_items_rw on public.return_items
  for all using (exists (select 1 from public.return_requests r where r.id = return_request_id
      and (r.customer_id = auth.uid() or public.is_admin()
           or exists (select 1 from public.seller_orders so where so.id = r.seller_order_id and public.is_seller_member(so.seller_id)))))
  with check (exists (select 1 from public.return_requests r where r.id = return_request_id
      and (r.customer_id = auth.uid() or public.is_admin()
           or exists (select 1 from public.seller_orders so where so.id = r.seller_order_id and public.is_seller_member(so.seller_id)))));

-- ---------------------------------------------------------------------------
-- COMMERCE CONFIG
-- ---------------------------------------------------------------------------
create policy commission_rules_read on public.commission_rules
  for select using (true);
create policy commission_rules_admin on public.commission_rules
  for all using (public.is_admin()) with check (public.is_admin());

create policy shipping_rules_read on public.shipping_rules for select using (true);
create policy shipping_rules_member on public.shipping_rules
  for all using (public.is_seller_member(seller_id) or public.is_admin())
  with check (public.is_seller_member(seller_id) or public.is_admin());

create policy coupons_read on public.coupons
  for select using (active or public.is_admin() or public.is_seller_member(seller_id));
create policy coupons_write on public.coupons
  for all using (public.is_admin() or public.is_seller_member(seller_id))
  with check (public.is_admin() or public.is_seller_member(seller_id));
create policy coupon_redemptions_read on public.coupon_redemptions
  for select using (customer_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- REVIEWS
-- ---------------------------------------------------------------------------
create policy reviews_public_read on public.reviews
  for select using (status = 'APPROVED' or customer_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.stores s where s.id = store_id and public.is_seller_member(s.seller_id)));
create policy reviews_customer_insert on public.reviews
  for insert with check (customer_id = auth.uid());
create policy reviews_customer_update on public.reviews
  for update using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy reviews_seller_respond on public.reviews
  for update using (exists (select 1 from public.stores s where s.id = store_id and public.is_seller_member(s.seller_id)))
  with check (exists (select 1 from public.stores s where s.id = store_id and public.is_seller_member(s.seller_id)));
create policy reviews_admin on public.reviews
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- PERFORMANCE / NOTIFICATIONS / ANALYTICS / AUDIT
-- ---------------------------------------------------------------------------
create policy seller_performance_read on public.seller_performance
  for select using (public.is_seller_member(seller_id) or public.is_admin());

create policy notifications_owner on public.notifications
  for all using (recipient_id = auth.uid() or public.is_admin())
  with check (recipient_id = auth.uid() or public.is_admin());

create policy analytics_insert on public.analytics_events for insert with check (true);
create policy analytics_read on public.analytics_events
  for select using (public.is_admin() or (seller_id is not null and public.is_seller_member(seller_id)));

create policy audit_admin on public.audit_logs
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- CUSTOMER-OWNED: addresses, wishlist, saved stores
-- ---------------------------------------------------------------------------
create policy addresses_owner on public.addresses
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy wishlist_owner on public.wishlist_items
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy saved_stores_owner on public.saved_stores
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());


-- ####################################################################
-- ## FILE: 0005_seed_triggers.sql
-- ####################################################################

-- ============================================================================
-- SAKDHA MARKETPLACE — Triggers & seed (0005)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up (default: customer).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'customer')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- keep products.updated_at fresh.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- DEFAULT COMMISSION RULE — 2% of product subtotal (configurable).
-- ---------------------------------------------------------------------------
insert into public.commission_rules (name, percentage, applies_to, active)
values ('Default marketplace commission', 2.00, 'PRODUCT_SUBTOTAL', true);

-- ---------------------------------------------------------------------------
-- SEED CATEGORIES (top-level fashion taxonomy for discovery + SEO).
-- ---------------------------------------------------------------------------
insert into public.categories (slug, name, seo_title, seo_description, position) values
  ('sarees',          'Sarees',          'Buy Sarees Online — Cotton, Silk & More | Sakdha', 'Shop sarees from fashion stores across India. Cotton, silk, designer and festive sarees.', 1),
  ('kurtis',          'Kurtis',          'Women''s Kurtis Online | Sakdha',                 'Discover kurtis from independent fashion stores. Cotton, anarkali, printed & party wear.', 2),
  ('dresses',         'Dresses',         'Women''s Dresses Online | Sakdha',                'Shop dresses for every occasion from fashion stores across India.', 3),
  ('mens-shirts',     'Men''s Shirts',   'Men''s Shirts Online | Sakdha',                   'Casual, formal and festive shirts from fashion stores across India.', 4),
  ('kids-wear',       'Kids Wear',       'Kids Fashion Online | Sakdha',                    'Shop kids fashion from independent stores across India.', 5),
  ('accessories',     'Accessories',     'Fashion Accessories Online | Sakdha',             'Bags, jewellery and fashion accessories from stores across India.', 6),
  ('ethnic-wear',     'Ethnic Wear',     'Ethnic & Festive Wear Online | Sakdha',           'Traditional and festive fashion from stores across India.', 7),
  ('western-wear',    'Western Wear',    'Western Wear Online | Sakdha',                    'Tops, jeans and western fashion from stores across India.', 8);

-- Subcategory examples under Sarees.
insert into public.categories (slug, name, parent_id, position)
select v.slug, v.name, c.id, v.position
from (values
  ('cotton-sarees','Cotton Sarees',1),
  ('silk-sarees','Silk Sarees',2)
) as v(slug, name, position)
cross join (select id from public.categories where slug = 'sarees') c;


commit;

-- Verify afterwards:
--   select count(*) from pg_tables where schemaname = 'public';      -- expect 39
--   select count(*) from pg_policies where schemaname = 'public';     -- expect 60
--   select slug, name from public.categories order by position;  -- 10 rows
--   select name, percentage from public.commission_rules;        -- 2.00
