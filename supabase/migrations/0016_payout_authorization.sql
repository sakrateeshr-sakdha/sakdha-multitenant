-- ============================================================================
-- SAKDHA COMMERCE — Payout authorization (0016)
--
-- Who may change where a store's money goes.
--
-- FIXES A LIVE PRIVILEGE GAP. The existing policy is:
--
--   create policy seller_bank_member on public.seller_bank_accounts
--     for all using (public.is_seller_member(seller_id) or public.is_admin())
--
-- `is_seller_member(x)` is `x = my_seller_id()`, and `my_seller_id()` falls
-- back to `seller_staff.seller_id`. So TODAY any staff member — someone added
-- to help with orders — has full read AND write on the bank account the
-- payouts go to. Changing one row there redirects every future payout.
--
-- The model after this migration:
--   • store owner            — may manage payout details
--   • member with an explicit grant — may manage payout details
--   • any other member       — no access, not even read
--   • unauthenticated        — no access
--
-- There is deliberately no `finance_admin` role: store_members.role is
-- constrained to ('owner','admin','staff') by 0012, and widening that CHECK
-- would be a breaking change. The grant is a separate explicit flag instead,
-- so "can see the orders dashboard" never implies "can move the money".
--
-- Apply with:  npm run bundle -- 0016   then paste supabase/apply_0016.sql
-- (the generated file supplies the begin/commit — do not add one here)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE EXPLICIT GRANT
--
-- Default false: granting must be a deliberate act. An owner does not need the
-- flag — ownership already implies it — so promoting someone to owner and
-- granting payout rights stay separate decisions.
-- ---------------------------------------------------------------------------
alter table public.store_members
  add column if not exists can_manage_payouts boolean not null default false;

comment on column public.store_members.can_manage_payouts is
  'Explicit grant to manage payout/bank details. Owners always may, flag or '
  'not. Never implied by role: staff and admin roles grant no payout access.';

-- ---------------------------------------------------------------------------
-- 2. AUTHORIZATION HELPERS
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_store_payouts(target_store uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.store_members m
     where m.store_id = target_store
       and m.profile_id = auth.uid()
       and (m.role = 'owner' or m.can_manage_payouts)
  );
$$;

comment on function public.can_manage_store_payouts(uuid) is
  'True if the caller owns the store or holds an explicit payout grant on it.';

-- Bank rows are still keyed by seller_id, so the seller-scoped question has to
-- be answerable too. Resolves seller -> store, then applies the same rule —
-- one definition of the policy, two entry points.
create or replace function public.can_manage_seller_payouts(target_seller uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.stores s
      join public.store_members m on m.store_id = s.id
     where s.seller_id = target_seller
       and m.profile_id = auth.uid()
       and (m.role = 'owner' or m.can_manage_payouts)
  );
$$;

grant execute on function public.can_manage_store_payouts(uuid) to authenticated;
grant execute on function public.can_manage_seller_payouts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. SEAL THE BANK TABLE
--
-- Split into explicit per-command policies. `for all` was doing too much: it
-- granted delete as well, and removing the payout account is as damaging as
-- changing it.
--
-- Note there is no UPDATE or DELETE policy at all. A payout change is an
-- insert-then-verify flow (section 4), performed server-side, so no client
-- session needs to mutate an existing row — and a stolen session therefore
-- cannot silently rewrite the account number in place.
-- ---------------------------------------------------------------------------
drop policy if exists seller_bank_member on public.seller_bank_accounts;

create policy seller_bank_payout_read on public.seller_bank_accounts
  for select using (
    public.is_admin() or public.can_manage_seller_payouts(seller_id)
  );

create policy seller_bank_payout_insert on public.seller_bank_accounts
  for insert with check (
    public.is_admin() or public.can_manage_seller_payouts(seller_id)
  );

-- ---------------------------------------------------------------------------
-- 4. CHANGE REQUESTS — a payout change is proposed, then verified, then active.
--
-- Modelled rather than applied straight to seller_bank_accounts because the
-- provider decides when a new account is usable: Razorpay's
-- PATCH /v2/accounts/{id}/products/{id} returns an `activation_status`, and
-- until that reports activated the old account is still the live beneficiary.
-- Writing the new details straight into the bank table would make the UI claim
-- a change that Razorpay has not accepted.
--
-- LIMITATION, recorded rather than worked around: Razorpay exposes no webhook
-- for settlement-account activation on a linked account. Moving a request from
-- `verifying` to `active` therefore requires polling fetchLinkedAccount() or an
-- admin confirming it. This table does not pretend otherwise.
-- ---------------------------------------------------------------------------
create table if not exists public.payout_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores(id) on delete cascade,
  seller_id          uuid not null references public.sellers(id) on delete cascade,
  requested_by       uuid not null references public.profiles(id) on delete restrict,
  account_name       text not null,
  /** Encrypted with the same AES-256-GCM key as seller_bank_accounts. */
  account_number_enc text not null,
  ifsc               text not null,
  /** Last 4 digits only, so the UI can show a change without decrypting. */
  account_last4      text,
  status             text not null default 'pending'
      check (status in ('pending','verifying','active','rejected','failed')),
  provider_ref       text,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  reviewed_at        timestamptz,
  note               text,
  created_at         timestamptz not null default now()
);

create index if not exists payout_change_requests_store_idx
  on public.payout_change_requests(store_id);
create index if not exists payout_change_requests_status_idx
  on public.payout_change_requests(status);

-- Only one change can be in flight per store: two concurrent requests would
-- race to become the beneficiary.
create unique index if not exists payout_change_requests_one_open
  on public.payout_change_requests(store_id)
  where status in ('pending', 'verifying');

alter table public.payout_change_requests enable row level security;

-- Readable by those who may manage payouts, so a requester can see status.
-- account_number_enc stays encrypted; the UI uses account_last4.
create policy payout_requests_read on public.payout_change_requests
  for select using (
    public.is_admin() or public.can_manage_store_payouts(store_id)
  );

-- No INSERT/UPDATE policy: requests are created and advanced by the server
-- action, which re-checks authorization and writes the audit trail. Allowing a
-- direct client insert would skip both.

-- ---------------------------------------------------------------------------
-- 5. OWNERSHIP CHANGES MUST NOT SILENTLY MOVE THE MONEY.
--
-- Transferring a store does not transfer the verified beneficiary: the new
-- owner must raise their own change request. Without this, acquiring ownership
-- would redirect payouts with no verification step at all.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_payout_grants_on_owner_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role is distinct from 'owner') then
    -- Any in-flight request predates this owner and was approved under the
    -- previous one; it must not activate under new control.
    update public.payout_change_requests
       set status = 'rejected',
           note = coalesce(note, '') || ' [auto-rejected: store ownership changed]',
           reviewed_at = now()
     where store_id = new.store_id
       and status in ('pending', 'verifying');
  end if;
  return new;
end $$;

drop trigger if exists store_members_owner_change on public.store_members;
create trigger store_members_owner_change
  after insert or update of role on public.store_members
  for each row execute function public.revoke_payout_grants_on_owner_change();

-- ---------------------------------------------------------------------------
-- 6. BACKFILL — existing store owners keep the access they already had.
-- ---------------------------------------------------------------------------
update public.store_members
   set can_manage_payouts = true
 where role = 'owner'
   and can_manage_payouts = false;

do $$
declare owners integer; granted integer;
begin
  select count(*) into owners from public.store_members where role = 'owner';
  select count(*) into granted from public.store_members where can_manage_payouts;
  raise notice '0016: % owner member(s), % member(s) may manage payouts.', owners, granted;
end $$;
