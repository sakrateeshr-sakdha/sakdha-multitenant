-- ============================================================================
-- FOLLOW-UP TO 0012 — restore public visibility for pre-existing stores.
--
-- 0012 added `stores.status` with a DRAFT default, which is correct for a store
-- created from now on: it is a draft until its owner publishes it. But the two
-- stores that already existed were live under the marketplace model, and the
-- new `stores_public_read` policy gates on `status = 'ACTIVE'`. The default
-- therefore un-published them, and because `products_public_read` also requires
-- the parent store to be ACTIVE, their products went dark too.
--
-- Run this ONLY if you want those stores publicly readable again. Skip it if
-- you would rather exercise the draft → publish flow by hand.
--
-- Safe to re-run: it touches only stores that are still DRAFT and predate the
-- migration, and never publishes a store created after it.
-- ============================================================================

begin;

update public.stores
   set status = 'ACTIVE',
       published_at = coalesce(published_at, now())
 where status = 'DRAFT'
   and slug in ('indigo-loom', 'meera-handlooms');

-- Show the result before committing, so a wrong row count is visible.
select slug, status, published_at is not null as published
  from public.stores
 order by slug;

commit;
