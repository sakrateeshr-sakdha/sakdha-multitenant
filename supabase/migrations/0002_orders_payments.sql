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
