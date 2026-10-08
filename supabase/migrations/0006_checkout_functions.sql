-- ============================================================================
-- SAKDHA MARKETPLACE — Checkout primitives (0006)
--
-- Inventory moves through three states:
--   available = inventory_qty - reserved_qty
--   reserve  → at Razorpay order creation (holds stock while the customer pays)
--   commit   → on payment.captured   (stock actually leaves)
--   release  → on failure/timeout    (hold expires, stock returns)
--
-- Each function is SECURITY DEFINER and EXECUTE is revoked from anon and
-- authenticated: only the service role (checkout routes, webhooks, the sweep
-- cron) may move stock. A customer must never be able to call these directly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Human-readable order numbers: SKD-2610-001042
-- ---------------------------------------------------------------------------
create sequence if not exists public.order_number_seq start 1000;

create or replace function public.next_order_number()
returns text language sql volatile set search_path = public as $$
  select 'SKD-' || to_char(now(), 'YYMM') || '-'
         || lpad(nextval('public.order_number_seq')::text, 6, '0');
$$;

-- ---------------------------------------------------------------------------
-- Reserve stock. Raises INSUFFICIENT_STOCK if any line cannot be satisfied —
-- the caller runs inside a transaction, so a failure reserves nothing.
--
-- p_items: [{"variant_id": "<uuid>", "qty": 2}, ...]
-- Lines without a variant_id (simple products) are skipped: there is no
-- per-variant stock to hold.
--
-- The guard lives in the WHERE clause so the check and the increment are a
-- single atomic statement. Two concurrent buyers of the last unit cannot both
-- pass: the second finds row_count = 0 and aborts.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_inventory(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  item         jsonb;
  v_variant_id uuid;
  v_qty        integer;
  v_updated    integer;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    v_variant_id := nullif(item->>'variant_id', '')::uuid;
    v_qty        := coalesce((item->>'qty')::integer, 0);

    if v_variant_id is null or v_qty <= 0 then
      continue;
    end if;

    update public.product_variants
       set reserved_qty = reserved_qty + v_qty
     where id = v_variant_id
       and is_active
       and inventory_qty - reserved_qty >= v_qty;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'INSUFFICIENT_STOCK:%', v_variant_id
        using errcode = 'P0001';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Release a hold (payment failed, abandoned, or swept). Never goes negative.
-- ---------------------------------------------------------------------------
create or replace function public.release_inventory(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  item         jsonb;
  v_variant_id uuid;
  v_qty        integer;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    v_variant_id := nullif(item->>'variant_id', '')::uuid;
    v_qty        := coalesce((item->>'qty')::integer, 0);
    if v_variant_id is null or v_qty <= 0 then
      continue;
    end if;

    update public.product_variants
       set reserved_qty = greatest(0, reserved_qty - v_qty)
     where id = v_variant_id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Payment captured: the held stock actually leaves inventory.
-- ---------------------------------------------------------------------------
create or replace function public.commit_inventory(p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  item         jsonb;
  v_variant_id uuid;
  v_qty        integer;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    v_variant_id := nullif(item->>'variant_id', '')::uuid;
    v_qty        := coalesce((item->>'qty')::integer, 0);
    if v_variant_id is null or v_qty <= 0 then
      continue;
    end if;

    update public.product_variants
       set inventory_qty = greatest(0, inventory_qty - v_qty),
           reserved_qty  = greatest(0, reserved_qty - v_qty)
     where id = v_variant_id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Sweep: release holds for orders that never got paid. Called by the cron
-- route. Returns how many orders it expired.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_reservations(p_older_than interval default interval '30 minutes')
returns integer language plpgsql security definer set search_path = public as $$
declare
  rec     record;
  v_count integer := 0;
begin
  for rec in
    select o.id,
           coalesce(
             jsonb_agg(jsonb_build_object('variant_id', oi.variant_id, 'qty', oi.qty))
               filter (where oi.variant_id is not null),
             '[]'::jsonb
           ) as items
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
     where o.payment_status = 'PENDING_PAYMENT'
       and o.created_at < now() - p_older_than
     group by o.id
  loop
    perform public.release_inventory(rec.items);

    update public.orders
       set payment_status = 'FAILED',
           order_status   = 'CANCELLED'
     where id = rec.id;

    update public.seller_orders
       set status = 'CANCELLED'
     where order_id = rec.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Stock movement is service-role only.
-- ---------------------------------------------------------------------------
revoke execute on function public.reserve_inventory(jsonb) from public, anon, authenticated;
revoke execute on function public.release_inventory(jsonb) from public, anon, authenticated;
revoke execute on function public.commit_inventory(jsonb) from public, anon, authenticated;
revoke execute on function public.expire_stale_reservations(interval) from public, anon, authenticated;
revoke execute on function public.next_order_number() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Keep carts.updated_at honest so the abandoned-cart sweep can rely on it.
-- ---------------------------------------------------------------------------
drop trigger if exists carts_touch on public.carts;
create trigger carts_touch before update on public.carts
  for each row execute function public.touch_updated_at();
