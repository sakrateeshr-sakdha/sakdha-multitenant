-- ============================================================================
-- SAKDHA MARKETPLACE — Let sellers write shipment lines (0009)
--
-- BUG: 0004 gave public.shipment_items a SELECT policy but no write policy, so
-- with RLS enabled every INSERT failed with 42501. A seller could create the
-- shipment row itself (shipments_member_write exists) but never attach the
-- items to it, so recording a shipment always failed halfway and the order
-- could never leave READY_TO_SHIP.
--
-- The rule matches shipments: you may write a shipment line when you are a
-- member of the seller that owns the parent seller_order. Customers keep
-- read-only visibility through the existing SELECT policy.
-- ============================================================================

create policy shipment_items_member_write on public.shipment_items
  for all
  using (
    exists (
      select 1
        from public.shipments s
        join public.seller_orders so on so.id = s.seller_order_id
       where s.id = shipment_id
         and (public.is_seller_member(so.seller_id) or public.is_admin())
    )
  )
  with check (
    exists (
      select 1
        from public.shipments s
        join public.seller_orders so on so.id = s.seller_order_id
       where s.id = shipment_id
         and (public.is_seller_member(so.seller_id) or public.is_admin())
    )
  );

-- The original read policy only checked that the shipment exists, which leaned
-- entirely on the shipments policy to filter. Make the intent explicit so a
-- future change to shipments cannot silently widen this.
drop policy if exists shipment_items_read on public.shipment_items;
create policy shipment_items_read on public.shipment_items
  for select using (
    exists (
      select 1
        from public.shipments s
        join public.seller_orders so on so.id = s.seller_order_id
       where s.id = shipment_id
         and (
           public.is_seller_member(so.seller_id)
           or public.is_admin()
           or public.owns_order(so.order_id)
         )
    )
  );
