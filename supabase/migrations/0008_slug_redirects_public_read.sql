-- ============================================================================
-- SAKDHA MARKETPLACE — Let the redirect map be read (0008)
--
-- BUG: 0004 left public.product_slug_redirects with RLS enabled and NO policy,
-- grouping it with the financial tables. But this is catalogue data, not money:
-- the product page reads it (as the visitor) to answer a renamed URL with a
-- 301. With no SELECT policy the lookup always came back empty, so every old
-- product link 404'd instead of redirecting — silently losing the link equity
-- the table exists to preserve.
--
-- The contents are (old_slug -> product_id): already-public URL mapping, with
-- nothing sensitive in it. Reads become public; writes stay service-role only,
-- so a seller cannot forge a redirect to hijack someone else's URL.
-- ============================================================================

create policy product_slug_redirects_public_read on public.product_slug_redirects
  for select using (true);
