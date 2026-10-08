-- ============================================================================
-- SAKDHA MARKETPLACE — Fix mutually recursive order policies (0007)
--
-- BUG: 0004 defined
--   orders.orders_customer_read      → EXISTS (SELECT … FROM seller_orders …)
--   seller_orders.seller_orders_read → EXISTS (SELECT … FROM orders …)
--
-- Each subquery is itself subject to RLS, so evaluating one policy triggers the
-- other and Postgres aborts with 42P17 "infinite recursion detected in policy".
-- Every read of orders or seller_orders failed — customers could not see their
-- own orders and the seller dashboard could not list anything. It went
-- unnoticed because the tables were empty until the first real checkout.
--
-- FIX: move the cross-table checks into SECURITY DEFINER helpers. They run as
-- the table owner, which is not subject to these policies, so the cycle is
-- broken. Same visibility rules, evaluated once.
-- ============================================================================

-- Is the given order owned by the current user? Bypasses RLS by design.
create or replace function public.owns_order(p_order_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.orders
     where id = p_order_id
       and customer_id = auth.uid()
  );
$$;

-- Does the current user's seller have a child order on this parent order?
create or replace function public.sells_on_order(p_order_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.seller_orders so
     where so.order_id = p_order_id
       and so.seller_id = public.my_seller_id()
  );
$$;

-- These read other people's rows by design; they must stay callable so RLS can
-- use them, but they only ever answer questions about the CURRENT user.
grant execute on function public.owns_order(uuid) to anon, authenticated;
grant execute on function public.sells_on_order(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Replace the recursive policies.
-- ---------------------------------------------------------------------------
drop policy if exists orders_customer_read on public.orders;
create policy orders_customer_read on public.orders
  for select using (
    customer_id = auth.uid()
    or public.is_admin()
    or public.sells_on_order(id)
  );

drop policy if exists seller_orders_read on public.seller_orders;
create policy seller_orders_read on public.seller_orders
  for select using (
    public.is_seller_member(seller_id)
    or public.is_admin()
    or public.owns_order(order_id)
  );

-- ---------------------------------------------------------------------------
-- The same cycle, one level out: these policies reach into orders/seller_orders
-- too. Routing them through the helpers keeps every path non-recursive.
-- ---------------------------------------------------------------------------
drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items
  for select using (
    public.is_admin()
    or public.owns_order(order_id)
    or exists (
      select 1 from public.seller_orders so
       where so.id = seller_order_id
         and so.seller_id = public.my_seller_id()
    )
  );

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select using (public.is_admin() or public.owns_order(order_id));

drop policy if exists refunds_read on public.refunds;
create policy refunds_read on public.refunds
  for select using (
    public.is_admin()
    or public.owns_order(order_id)
    or exists (
      select 1 from public.seller_orders so
       where so.id = seller_order_id
         and so.seller_id = public.my_seller_id()
    )
  );
