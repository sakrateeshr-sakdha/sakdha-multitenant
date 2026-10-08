-- ============================================================================
-- SAKDHA MARKETPLACE — Review aggregates & verified-purchase guard (0011)
--
-- products.rating_avg / rating_count and the store equivalents are read by the
-- PDP, the grid, the sitemap gate and — critically — the Product JSON-LD that
-- Google reads. If they drift from the reviews table we publish wrong ratings
-- in structured data, which is a manual-action risk.
--
-- Keeping them in a trigger rather than application code means every path
-- (seller tools, admin moderation, a future import) stays consistent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Only APPROVED reviews count toward a public rating.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_rating_aggregates()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_product_id uuid;
  v_store_id   uuid;
begin
  v_product_id := coalesce(new.product_id, old.product_id);
  v_store_id   := coalesce(new.store_id, old.store_id);

  if v_product_id is not null then
    update public.products p
       set rating_avg = coalesce((
             select round(avg(r.rating)::numeric, 2)
               from public.reviews r
              where r.product_id = v_product_id and r.status = 'APPROVED'
           ), 0),
           rating_count = (
             select count(*)
               from public.reviews r
              where r.product_id = v_product_id and r.status = 'APPROVED'
           )
     where p.id = v_product_id;
  end if;

  if v_store_id is not null then
    update public.stores s
       set rating_avg = coalesce((
             select round(avg(r.rating)::numeric, 2)
               from public.reviews r
              where r.store_id = v_store_id and r.status = 'APPROVED'
           ), 0),
           rating_count = (
             select count(*)
               from public.reviews r
              where r.store_id = v_store_id and r.status = 'APPROVED'
           )
     where s.id = v_store_id;
  end if;

  return null; -- AFTER trigger
end $$;

drop trigger if exists reviews_refresh_aggregates on public.reviews;
create trigger reviews_refresh_aggregates
  after insert or update or delete on public.reviews
  for each row execute function public.refresh_rating_aggregates();

-- ---------------------------------------------------------------------------
-- One review per purchased line. Without this a customer could review the same
-- item repeatedly and move the average on their own.
-- ---------------------------------------------------------------------------
create unique index if not exists reviews_order_item_key
  on public.reviews(order_item_id)
  where order_item_id is not null;

-- ---------------------------------------------------------------------------
-- Reviews are verified-purchase only, and that must not rest on application
-- code alone: the INSERT policy already lets a customer write their own row,
-- so without this they could post a review for a product they never bought.
-- ---------------------------------------------------------------------------
create or replace function public.customer_bought_item(p_order_item_id uuid, p_product_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      join public.seller_orders so on so.id = oi.seller_order_id
     where oi.id = p_order_item_id
       and oi.product_id = p_product_id
       and o.customer_id = auth.uid()
       and o.payment_status = 'PAID'
       and so.status = 'DELIVERED'
  );
$$;

grant execute on function public.customer_bought_item(uuid, uuid) to anon, authenticated;

drop policy if exists reviews_customer_insert on public.reviews;
create policy reviews_customer_insert on public.reviews
  for insert with check (
    customer_id = auth.uid()
    and order_item_id is not null
    and public.customer_bought_item(order_item_id, product_id)
  );

-- A customer may edit their own review's text, but must never be able to flip
-- its moderation status or re-point it at a different purchase.
drop policy if exists reviews_customer_update on public.reviews;
create policy reviews_customer_update on public.reviews
  for update using (customer_id = auth.uid())
  with check (
    customer_id = auth.uid()
    and order_item_id is not null
    and public.customer_bought_item(order_item_id, product_id)
  );
