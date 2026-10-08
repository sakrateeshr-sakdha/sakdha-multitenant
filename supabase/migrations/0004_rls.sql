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
