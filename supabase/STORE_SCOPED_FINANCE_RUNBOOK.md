# Store-scoped finance — deployment runbook (0013–0016)

Moves financial ownership from `seller_id` to `store_id + seller_id` under the rule
**one store ↔ one seller ↔ one payout account**, without breaking checkout, seller
workflows, Razorpay transfers, or historical records.

`seller_id` is **retained everywhere**. It remains the payee and the Razorpay
beneficiary. Nothing in this sequence removes a legacy column.

## Order of operations

The ordering matters: **0015 must not run before the dual-write app release is live**,
or an older build writing only `seller_id` will start failing the new constraints.

| # | Step | Reversible | Changes money |
|---|------|-----------|---------------|
| 1 | Paste `apply_0013.sql` (EXPAND) | yes | no |
| 2 | Paste `apply_0014.sql` (BACKFILL) | partially — see below | **yes** |
| 3 | Deploy app (dual writes) | yes | no |
| 4 | Paste `apply_0015.sql` (ENFORCE) | yes | no |
| 5 | Paste `apply_0016.sql` (payout authz) | yes | no |

Run `npm run check:store-finance` after each step. It detects which migrations are
applied and reports what is still outstanding.

## Step detail

### 1. `0013` — EXPAND
Adds nullable `store_id` to `ledger_entries` and `settlements`, four indexes, and the
resolvers `store_id_for_seller()` / `my_finance_store_ids()`. Purely additive: no
constraint, no NOT NULL, no behaviour change. Safe to apply at any time.

**Rollback:** `drop` the two columns and two functions. No data loss — nothing reads
them until step 3.

### 2. `0014` — BACKFILL ⚠ changes money
Populates `store_id` from each row's **own recorded relationships** (seller_order first,
then single-seller order, then seller mapping). Refuses to run if any seller owns more
than one store.

**Section 3 fixes a live bug:** refund ledger rows were written without `seller_id`, so
`settlePeriod()` skipped them and `getSellerEarnings()` never matched them — refunds have
never reduced a payout. Backfilling the attribution means the next settlement run pays
**less** for affected periods.

Verified impact on current data — Oct 2026, seller `e7c0c4de`:

```
before   earned 431004  refunds      0   netPayable 431004   (₹4,310.04)
after    earned 431004  refunds 739600   netPayable      0
```

Sept 2026 is already `paid` and is not retroactively altered; `runSettlement` skips rows
already marked paid.

**Rollback:** `update ledger_entries set store_id = null; update settlements set store_id
= null;` restores the store columns. The `seller_id` attribution on refund rows is the
*correct* value — reverting it reintroduces the bug. Capture `check:store-finance` output
before running so the prior state is recorded.

### 3. App release — dual writes
Deploy before 0015. Changed paths:
- `webhooks/razorpay` — ledger rows carry `store_id` from the seller_order; refund rows
  now resolve and persist `seller_id` + `store_id`, validated against the order.
- `actions/settlement` — settlement rows carry `store_id`; refuses a run where any payee
  has no resolvable store.

**Rollback:** redeploy the previous build. It writes only `seller_id`, which the 0013/0014
schema still accepts (columns are nullable until 0015).

### 4. `0015` — ENFORCE
Adds `unique(stores.seller_id)`, composite FKs `(store_id, seller_id) → stores(id,
seller_id)` on all three financial tables, a check that a ledger row is fully attributed
or fully platform-level, `settlements.store_id NOT NULL`, and store-scoped RLS that
**keeps** the seller path alongside the new store path.

Every constraint validates against existing rows on creation. If one fails, the backfill
is incomplete — fix the data, never weaken the constraint.

`ledger_entries.store_id` is deliberately **not** NOT NULL: `PAYMENT_GATEWAY_FEE` rows are
Sakdha's cost and belong to no store.

**Rollback:** drop the named constraints and restore the prior policies from
`0004_rls.sql`. Constraint names are all explicit.

### 5. `0016` — payout authorization
Closes a live privilege gap: the existing `seller_bank_member` policy grants `for all` to
`is_seller_member()`, which resolves through `seller_staff` — **any staff member can
currently read and rewrite the bank account that receives payouts.**

After: owner or explicit `can_manage_payouts` grant only; separate per-command policies;
no UPDATE/DELETE policy at all. Adds `payout_change_requests` (propose → verify → active)
and auto-rejects in-flight requests when store ownership changes.

**Rollback:** restore `seller_bank_member` from `0004_rls.sql`, drop the new table,
trigger, functions and column. Note this reopens the privilege gap.

## Known limitation (not worked around)

Razorpay exposes **no webhook for settlement-account activation** on a linked account.
`updateSettlementAccount()` returns `activation_status`, but moving a payout request from
`verifying` to `active` requires polling `fetchLinkedAccount()` or an admin confirming it.
`payout_change_requests.status` models this honestly rather than claiming a change the
provider has not accepted.

## Not done here

- Store-scoped **read** cutover in `src/lib/db/finance.ts` — reads still filter by
  `seller_id`. Correct isolation today under one-to-one, and 0015's RLS accepts both
  paths, so this can land as a later release.
- `payout_change_requests` has no server action or UI yet; the table and policies exist.
- `seller_orders.store_id` was already NOT NULL since 0002 but **unindexed** — 0013 adds
  the index.
