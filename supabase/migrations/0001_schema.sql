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
