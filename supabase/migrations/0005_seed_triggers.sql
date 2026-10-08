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
