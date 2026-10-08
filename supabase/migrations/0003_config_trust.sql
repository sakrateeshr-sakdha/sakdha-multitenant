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
