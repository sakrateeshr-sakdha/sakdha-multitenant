-- ============================================================================
-- SAKDHA COMMERCE — Multi-tenant foundation (0012)
--
-- The product changes shape here: from one marketplace with many sellers, to
-- many independent stores each running on its own subdomain. `stores` becomes
-- the TENANT ROOT — every store-owned record hangs off store_id, and no query
-- may ever cross between stores.
--
-- What this migration does NOT do: touch orders/payments. Those restructure in
-- the checkout phase. This lays the tenancy, membership, template and domain
-- groundwork that store creation and the dashboard need.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- TEMPLATES — the catalogue a store picks its look from. Shared data model,
-- different arrangements (spec §9), so a template is configuration, not code.
-- ---------------------------------------------------------------------------
create table if not exists public.store_templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  preview_url text,
  /** Default theme + section layout a store starts from when choosing this. */
  defaults    jsonb not null default '{}',
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.store_templates (slug, name, description, position) values
  ('minimal-fashion', 'Minimal Fashion', 'Elegant, clean, editorial.', 1),
  ('modern-store',    'Modern Store',    'Bright, commercial, conversion-focused.', 2),
  ('premium',         'Premium',         'Restrained luxury with generous whitespace.', 3),
  ('trendy',          'Trendy',          'Bold and social-first, built for Instagram traffic.', 4)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- STORES become tenants.
--
-- The marketplace treated a store as a seller's shopfront inside Sakdha. Now
-- it is an independent business: it owns its own lifecycle, look, subdomain
-- and setup progress.
-- ---------------------------------------------------------------------------
alter table public.stores
  -- Direct ownership. The marketplace routed ownership through `sellers`;
  -- a tenant should not need that indirection to answer "whose store is this".
  add column if not exists owner_profile_id uuid references public.profiles(id) on delete restrict,
  add column if not exists status text not null default 'DRAFT'
      check (status in ('DRAFT','ACTIVE','SUSPENDED','CLOSED')),
  add column if not exists business_category text,
  add column if not exists template_id uuid references public.store_templates(id) on delete set null,
  -- Colours, fonts, section order and per-section content. Kept as one
  -- document because the builder saves it as a unit and templates differ in
  -- which sections they even have.
  add column if not exists theme_json jsonb not null default '{}',
  add column if not exists published_at timestamptz,
  -- Drives the dashboard setup checklist (spec §30).
  add column if not exists setup_json jsonb not null default '{}',
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists currency text not null default 'INR',
  add column if not exists timezone text not null default 'Asia/Kolkata';

-- Backfill ownership for stores created under the marketplace model.
update public.stores s
   set owner_profile_id = sel.owner_profile_id
  from public.sellers sel
 where s.seller_id = sel.id
   and s.owner_profile_id is null;

create index if not exists stores_owner_idx on public.stores(owner_profile_id);
create index if not exists stores_status_idx on public.stores(status);

comment on column public.stores.slug is
  'Subdomain label: <slug>.sakdha.com. Globally unique, immutable once published.';

-- ---------------------------------------------------------------------------
-- RESERVED SLUGS — a store must not be able to claim a platform hostname.
-- Table rather than a constant so the list is editable without a deploy.
-- ---------------------------------------------------------------------------
create table if not exists public.reserved_slugs (
  slug   text primary key,
  reason text
);

insert into public.reserved_slugs (slug, reason) values
  ('www','platform'), ('app','platform'), ('api','platform'), ('admin','platform'),
  ('dashboard','platform'), ('account','platform'), ('billing','platform'),
  ('support','platform'), ('help','platform'), ('docs','platform'), ('blog','platform'),
  ('mail','infrastructure'), ('smtp','infrastructure'), ('ftp','infrastructure'),
  ('cdn','infrastructure'), ('assets','infrastructure'), ('static','infrastructure'),
  ('staging','infrastructure'), ('dev','infrastructure'), ('test','infrastructure'),
  ('sakdha','brand'), ('store','generic'), ('stores','generic'), ('shop','generic'),
  ('checkout','generic'), ('cart','generic'), ('login','generic'), ('signup','generic')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- MEMBERSHIP — who may act for a store. Replaces seller_staff, which was keyed
-- to the seller entity rather than the tenant.
-- ---------------------------------------------------------------------------
create table if not exists public.store_members (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references public.stores(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'staff' check (role in ('owner','admin','staff')),
  created_at timestamptz not null default now(),
  unique (store_id, profile_id)
);
create index if not exists store_members_profile_idx on public.store_members(profile_id);

-- Every existing store owner becomes an owner-member of their store.
insert into public.store_members (store_id, profile_id, role)
select s.id, s.owner_profile_id, 'owner'
  from public.stores s
 where s.owner_profile_id is not null
on conflict (store_id, profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- CUSTOM DOMAINS — modelled now so the tenant resolver has one lookup path,
-- even though verification lands in a later phase (spec §15).
-- ---------------------------------------------------------------------------
create table if not exists public.store_domains (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  domain      text not null unique,
  is_primary  boolean not null default false,
  verified_at timestamptz,
  /** Token the owner puts in DNS TXT to prove control. */
  verify_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at  timestamptz not null default now()
);
create index if not exists store_domains_store_idx on public.store_domains(store_id);

-- ---------------------------------------------------------------------------
-- TENANT HELPERS — SECURITY DEFINER so policies can ask "is this mine?"
-- without recursing through the policies they are evaluating.
-- ---------------------------------------------------------------------------
create or replace function public.is_store_member(target_store uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.store_members
     where store_id = target_store
       and profile_id = auth.uid()
  );
$$;

create or replace function public.my_store_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select store_id from public.store_members where profile_id = auth.uid();
$$;

grant execute on function public.is_store_member(uuid) to anon, authenticated;
grant execute on function public.my_store_ids() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.store_templates enable row level security;
alter table public.reserved_slugs enable row level security;
alter table public.store_members enable row level security;
alter table public.store_domains enable row level security;

-- Template catalogue and reserved list are public reference data.
drop policy if exists store_templates_read on public.store_templates;
create policy store_templates_read on public.store_templates
  for select using (is_active or public.is_admin());
drop policy if exists store_templates_admin on public.store_templates;
create policy store_templates_admin on public.store_templates
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists reserved_slugs_read on public.reserved_slugs;
create policy reserved_slugs_read on public.reserved_slugs for select using (true);
drop policy if exists reserved_slugs_admin on public.reserved_slugs;
create policy reserved_slugs_admin on public.reserved_slugs
  for all using (public.is_admin()) with check (public.is_admin());

-- Membership is visible to the store's own team, and to platform admins.
drop policy if exists store_members_read on public.store_members;
create policy store_members_read on public.store_members
  for select using (profile_id = auth.uid() or public.is_store_member(store_id) or public.is_admin());
-- Only an owner may change the team, so staff cannot promote themselves.
drop policy if exists store_members_owner_write on public.store_members;
create policy store_members_owner_write on public.store_members
  for all using (
    public.is_admin()
    or exists (
      select 1 from public.store_members m
       where m.store_id = store_members.store_id
         and m.profile_id = auth.uid()
         and m.role = 'owner'
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.store_members m
       where m.store_id = store_members.store_id
         and m.profile_id = auth.uid()
         and m.role = 'owner'
    )
  );

-- A domain must be readable unauthenticated: the tenant resolver looks up the
-- host on every request before any user exists.
drop policy if exists store_domains_public_read on public.store_domains;
create policy store_domains_public_read on public.store_domains for select using (true);
drop policy if exists store_domains_member_write on public.store_domains;
create policy store_domains_member_write on public.store_domains
  for all using (public.is_store_member(store_id) or public.is_admin())
  with check (public.is_store_member(store_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- STORES policy: published storefronts are public; drafts are team-only.
-- Replaces the marketplace policy, which exposed every store unconditionally.
-- ---------------------------------------------------------------------------
drop policy if exists stores_public_read on public.stores;
create policy stores_public_read on public.stores
  for select using (
    status = 'ACTIVE'
    or public.is_store_member(id)
    or public.is_admin()
  );

drop policy if exists stores_member_write on public.stores;
create policy stores_member_write on public.stores
  for update using (public.is_store_member(id) or public.is_admin())
  with check (public.is_store_member(id) or public.is_admin());

-- A signed-in user may create a store, but only one they own.
drop policy if exists stores_owner_insert on public.stores;
create policy stores_owner_insert on public.stores
  for insert with check (owner_profile_id = auth.uid());

-- ---------------------------------------------------------------------------
-- PRODUCTS follow the tenant, not the seller.
-- ---------------------------------------------------------------------------
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select using (
    (status = 'ACTIVE' and exists (
      select 1 from public.stores s where s.id = products.store_id and s.status = 'ACTIVE'
    ))
    or public.is_store_member(store_id)
    or public.is_admin()
  );

drop policy if exists products_member_write on public.products;
create policy products_member_write on public.products
  for all using (public.is_store_member(store_id) or public.is_admin())
  with check (public.is_store_member(store_id) or public.is_admin());
