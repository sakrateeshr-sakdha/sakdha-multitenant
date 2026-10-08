# SAKDHA FASHION MARKETPLACE — Architecture Analysis & Migration Plan

> **Status:** Analysis & proposal. No destructive changes made. Awaiting approval.
> **Date:** 2026-10-05

---

## 0. Executive summary

The directory I was invoked in (`marketplace/`) is **empty**. The "existing Sakdha
ecosystem" is the sibling project **`boutique/`** — but that is a *different product*:
a **tailoring-shop management SaaS** (single owner per shop, customers, measurements,
designers, subscription billing). It is **not** a marketplace and its schema does not
model multiple independent stores, a shared cart, split payments, or seller settlement.

**Recommendation:** build Sakdha as a **fresh Next.js app in `marketplace/`**, reusing
`boutique/`'s *proven infrastructure patterns* (Supabase SSR clients, Razorpay HMAC
signature verification, RLS helper-function style, CSP config, SEO scaffolding, UI
conventions) but with a **new marketplace-shaped database and domain model**. The
boutique SaaS keeps running untouched — nothing destructive, no shared database tables.

Three decisions need your sign-off before coding (see §15). Everything else below is my
recommended default.

---

## 1. Current architecture (`boutique/`)

| Layer | What exists |
|---|---|
| Framework | **Next.js 16.1.6** (App Router), **React 19.2.3**, **TypeScript 5** |
| Styling | **Tailwind CSS 3.4** + `@tailwindcss/typography`, CSS custom-property theming (`.theme-wine`), Google Fonts (Cormorant Garamond + Outfit) |
| Data | **Supabase Postgres** via `@supabase/ssr` (browser) + `@supabase/supabase-js` (service role) |
| Auth | **Supabase Auth**, PKCE flow, client-side `AuthContext` |
| Payments | **Razorpay 2.9.6** — *subscription billing only* (SaaS plans) |
| Images | **Cloudinary** (upload preset + server SDK) — **not** Supabase Storage |
| Email | **Resend** |
| Charts / UI | Recharts, Framer Motion, lucide-react, react-hot-toast |
| PDF / print | @react-pdf, jspdf, pdfmake, thermal printer, QR (qrcode/jsqr) |
| Hosting | **Vercel** (Speed Insights, deploy hook, cron via `/api/cron/*`), CSP headers in `next.config.ts` |
| Testing | Playwright E2E (page-object model), AIO test push scripts |

Shape: a **multi-tenant SaaS** keyed by `boutique_id`. Three role tiers:
`owner` → `employee` (with custom `boutique_roles.allowed_modules`) → `supreme`
(platform admin). Route groups: `(public)` marketing, `(owner)` product, `(supreme)`
admin, `marketing/*` lead team.

## 2. Existing database / schema

Tables referenced in code (Supabase Postgres):

```
profiles, boutiques, employees, boutique_roles, boutique_settings, branches,
subscriptions, subscription_plans, trial_requests,
customers, measurements, measurement_templates,
orders, orders_with_customer (view), order_items, order_item_designs,
order_activities, product_variants, inventory_items, inventory_categories,
designs, design_categories, workflow_stages,
payments, taxes, monthly_tax_filings,
blogs, marketing_leads, demo_requests, exit_intent_leads,
incomplete_demo_requests, incomplete_registrations
```

Migrations live in `supabase/migrations/*.sql` (plain SQL, timestamp-named). RLS is
**partially** deployed (Phase 1 + Phase 2a) using `SECURITY DEFINER` helper functions
(`public.is_supreme()`, `public.current_boutique_id()`) and a privilege-escalation guard
trigger on `profiles.role`. **Verdict:** none of these tables model a marketplace;
they are tailoring-domain. We reuse the *RLS pattern*, not the tables.

## 3. Existing authentication

- Supabase Auth, PKCE, custom `storageKey: "boutique-manager-auth"`.
- `AuthContext.tsx` fetches `profiles` → falls back to `employees` (maps to a synthetic
  profile) → loads `boutique_roles.allowed_modules` for module-level gating → loads plan
  features. Note the deliberate `setTimeout(…,0)` deferral inside `onAuthStateChange`
  to avoid the Supabase auth-lock deadlock — **reuse this pattern verbatim**, it's a
  real footgun.
- Authorization today is largely **client-side** (route guards in layouts) with RLS
  still being rolled out. For a marketplace handling money this is insufficient — we go
  **server-side + RLS-first** from day one.

## 4. Existing Supabase setup

- `supabaseClient.ts` — browser client (`createBrowserClient`, anon key, persisted session).
- `supabaseServer.ts` — service-role client (bypasses RLS; server-only).
- **Reuse both verbatim** (new storageKey). **Gap:** there is no request-scoped SSR
  server client that reads the user's cookie session — needed for secure Server
  Components / Route Handlers that act *as the user* under RLS. We add
  `createServerClient` (cookie-bound) as a third client.

## 5. Existing payment integration

- `api/razorpay/create-subscription`, `verify-subscription`, `webhook`.
- Webhook does **correct HMAC-SHA256 signature verification** against
  `RAZORPAY_WEBHOOK_SECRET` on the raw body — **reuse this pattern exactly.**
- Events handled: `subscription.charged` (SaaS recurring). **Not present:** one-time
  order payments, **Razorpay Route** (linked accounts / transfers / split settlement),
  `payment.captured/authorized/failed`, refund/transfer webhooks, idempotency keys.
- **Verdict:** signature-verification plumbing reusable; the *subscription* business
  logic is irrelevant to marketplace order payments. Marketplace payment layer is net-new.

## 6. Existing components

- `ui/`: `Button`, `Card`, `Logo`, `FileTypeIcons` — thin kit.
- `layout/`: `BottomNav`, `Header`, `DesktopTopBar` + `Sidebar`, `MobileSidebar`.
- Product: `StatCard`, `RevenueChart`, `PaymentModal`, `StructuredData`, `ThemeToggle`,
  blog components, invoice/PDF renderers.
- **Reusable:** `Button`, `Card`, `StatCard`, `RevenueChart`, `StructuredData`,
  `ThemeToggle`, `BottomNav` shell, toast setup, CSS-variable theming approach.
- **Missing for marketplace:** `ProductCard`, `StoreCard`, `Price`, `Rating`,
  `CartDrawer`, `FilterPanel`, `SearchBar`, `OrderTimeline`, `ShipmentCard`,
  `PaymentSummary`, `Breadcrumb`, `Pagination`, `Drawer`, `Tabs`, `Badge`, `Modal`,
  `Select`, `Input` — the full design-system from spec §48.

## 7. Existing routes

`(public)` marketing + auth; `(owner)` dashboard/customers/orders/inventory/reports/
settings/subscription; `(supreme)` platform admin; `blog/*`; `api/*`; `sitemap.ts`,
`robots.ts`, `head.tsx`. **None** map to marketplace discovery/store/product/cart/checkout.
The marketplace route tree (spec §19) is net-new.

## 8. What can be reused

**Directly (copy pattern):** Supabase browser + service clients; Razorpay webhook HMAC
verification; RLS `SECURITY DEFINER` helper style; `next.config.ts` CSP/headers; Vercel
cron pattern; `sitemap.ts`/`robots.ts`/`StructuredData` SEO scaffold; CSS-variable
theming; toast + Button/Card primitives; AuthContext deadlock-avoidance pattern; Resend
email; Recharts dashboards; Playwright page-object test structure.

**Conceptually:** multi-tenant isolation by id (boutique_id → store_id/seller_id);
role tiers (owner/employee/supreme → customer/seller/seller-staff/admin); plan-feature
gating idea → optional seller tiers later.

## 9. What needs to change / be added

- New **request-scoped SSR Supabase client** (cookie session, RLS-as-user).
- New **marketplace schema** (§10) — none of boutique's tables reused.
- **Razorpay Route** integration: linked-account onboarding, Orders API with
  `transfers`, order-payment webhooks, refunds, idempotency (§11).
- **Server-authoritative pricing/commission** engine (never trust client).
- Full **design system** + discovery/cart/checkout UI.
- **SEO architecture** for product/store/category/local intent (§12).
- Supabase **Storage** buckets for product/store media (if chosen over Cloudinary).
- Decision on **Tailwind vs Bootstrap** (spec §TS says avoid Tailwind; ecosystem uses it).

## 10. Proposed marketplace database schema

Postgres (Supabase). All money in **integer paise** (`bigint`) to avoid float drift.
Timestamps `timestamptz`. All tenant tables carry `seller_id` for RLS.

**Identity & stores**
```
profiles(id→auth.users, role[customer|seller|seller_staff|admin], full_name, phone, email)
sellers(id, owner_profile_id, legal_name, status[DRAFT|PENDING_VERIFICATION|
        PENDING_APPROVAL|ACTIVE|SUSPENDED|REJECTED], risk_level[EXCELLENT|GOOD|
        NEEDS_IMPROVEMENT|AT_RISK|SUSPENDED], razorpay_account_id,
        razorpay_product_config_id, kyc_json, created_at)
stores(id, seller_id, slug UNIQUE, name, logo_url, cover_url, description, city,
       state, pincode, social_json, return_policy, rating_avg, rating_count,
       product_count, is_indexable, created_at)
seller_staff(id, seller_id, profile_id, allowed_modules[])
seller_bank_accounts(id, seller_id, account_name, account_number_enc, ifsc, verified)
```

**Catalog**
```
categories(id, slug UNIQUE, parent_id, name, seo_title, seo_description, intro_md,
           is_indexable)
brands(id, slug, name)
products(id, store_id, seller_id, slug UNIQUE, name, description, short_description,
         category_id, brand_id, price, compare_at_price, gender, age_group, fabric,
         pattern, fit, occasion, wash_care, weight_grams, dims_json, status[DRAFT|
         ACTIVE|SUSPENDED|ARCHIVED], seo_title, seo_description, seo_keywords,
         canonical_url, rating_avg, rating_count, created_at)
product_media(id, product_id, url, type[image|video], position)
product_options(id, product_id, name)                 -- e.g. Size, Color
product_variants(id, product_id, sku, option_values_json, price_override,
                 inventory_qty, reserved_qty, is_active)
product_slug_redirects(old_slug, product_id, created_at)  -- 301s
```

**Cart (multi-store)**
```
carts(id, customer_id, created_at, updated_at)
cart_items(id, cart_id, product_id, variant_id, seller_id, store_id, qty,
           unit_price_snapshot)
```

**Orders — parent/child (spec §31)**
```
orders(id, order_number UNIQUE, customer_id, subtotal, discount_total,
       shipping_total, tax_total, grand_total, commission_total,
       payment_status[PENDING_PAYMENT|PAID|FAILED|REFUNDED|PARTIALLY_REFUNDED],
       order_status[…spec §32 parent…], razorpay_order_id, razorpay_payment_id,
       shipping_address_json, created_at)
seller_orders(id, order_id, seller_id, store_id, subtotal, discount, shipping, tax,
       commission, seller_payable, status[…spec §32 seller…],
       dispatch_deadline, razorpay_transfer_id, created_at)
order_items(id, seller_order_id, order_id, product_id, variant_id, name_snapshot,
       sku_snapshot, qty, unit_price, line_total)
shipments(id, seller_order_id, carrier, tracking_number, status, shipping_method,
       estimated_delivery_from, estimated_delivery_to, shipped_at, delivered_at)
shipment_items(id, shipment_id, order_item_id, qty)
```

**Payments, splits, ledger, settlement (spec §31, §37)**
```
payments(id, order_id, razorpay_payment_id, amount, status, method, captured_at,
         raw_event_json)
payment_splits(id, seller_order_id, razorpay_transfer_id, amount, commission,
         status, settled_at)
settlements(id, seller_id, period, gross, commission, refunds, net_payable,
         razorpay_settlement_id, status)
ledger_entries(id, type[PRODUCT_SALE|SHIPPING|DISCOUNT|SAKDHA_COMMISSION|
         PAYMENT_GATEWAY_FEE|SELLER_PAYABLE|REFUND|REFUND_ADJUSTMENT|SETTLEMENT],
         order_id, seller_order_id, seller_id, amount, direction[debit|credit],
         ref_json, created_at)   -- every rupee traceable
```

**Returns / refunds (spec §33-34)**
```
return_requests(id, seller_order_id, customer_id, reason, status, created_at)
return_items(id, return_request_id, order_item_id, qty, refund_amount)
refunds(id, order_id, seller_order_id, razorpay_refund_id, amount, status,
        reason, created_at)
```

**Commerce config (spec §12, §38, §45)**
```
commission_rules(id, name, percentage, fixed_amount, applies_to[PRODUCT_SUBTOTAL|…],
        category_id, seller_id, active, valid_from, valid_until)  -- default 2% / PRODUCT_SUBTOTAL
shipping_rules(id, seller_id, type[FREE|FLAT|FREE_ABOVE], flat_fee,
        free_above_threshold, dispatch_sla_hours)
coupons(id, code UNIQUE, scope[MARKETPLACE|STORE|PRODUCT], funded_by[SAKDHA|SELLER],
        seller_id, type[PERCENT|FIXED], value, min_order, starts_at, ends_at, active)
coupon_redemptions(id, coupon_id, order_id, customer_id, amount)
```

**Reviews, performance, notifications, analytics (spec §14, §39, §44, §52)**
```
reviews(id, product_id, store_id, customer_id, order_item_id, rating, body,
        images_json, verified_purchase, seller_response, status[PENDING|APPROVED|
        REJECTED], created_at)
seller_performance(seller_id, total_orders, on_time_rate, late_rate,
        cancellation_rate, return_rate, refund_rate, rating_avg, odr, updated_at)
notifications(id, recipient_id, audience[customer|seller|admin], type, payload_json,
        read_at, created_at)
analytics_events(id, type, customer_id, seller_id, product_id, store_id,
        session_id, payload_json, created_at)
audit_logs(id, actor_id, action, entity, entity_id, diff_json, created_at)
```

**Inventory reservation:** reserve `product_variants.reserved_qty` at Razorpay-order
creation; confirm on `payment.captured`; release on failure/timeout (Vercel cron
sweep of stale reservations). Prevents overselling (spec §16).

## 11. Proposed payment architecture (Razorpay Route)

```
Cart → /api/checkout/quote   (server recomputes every number; returns breakdown)
     → /api/checkout/create-order
         • reserve inventory
         • create parent order + seller_orders (PENDING_PAYMENT)
         • Razorpay Orders API: ONE order with transfers[] — one transfer per
           seller's linked account, amount = seller_payable (product + seller
           shipping − seller-funded discount); Sakdha keeps commission + fees
         • persist razorpay_order_id
     → Razorpay Checkout (client) with that order_id
     → /api/checkout/verify   (HMAC verify order_id|payment_id|signature server-side)
     → Webhooks (idempotent, keyed by event id):
         payment.authorized → payment.captured → mark PAID, confirm inventory,
           write ledger (PRODUCT_SALE, COMMISSION, GATEWAY_FEE, SELLER_PAYABLE)
         payment.failed → release inventory, cancel
         transfer.processed / settled → update payment_splits + settlements
         refund.processed → refunds + REFUND/REFUND_ADJUSTMENT ledger
```

Rules: **never** trust client pricing/commission/status. Commission = `commission_rules`
(default **2% of product subtotal, excluding shipping**, configurable). No custom wallet;
money moves only via Route transfers. Provider code isolated behind a
`lib/payments/razorpay/` adapter so Route config can change without touching order logic.
Sellers blocked from receiving orders until linked-account onboarding completes (spec §10).

## 12. Proposed SEO architecture

- **URLs (spec §19):** `/`, `/store/[storeSlug]`, `/product/[productSlug]`,
  `/category/[cat]`, `/category/[cat]/[sub]`, `/collections/[slug]`,
  `/city/[city]/stores`. Stable slugs; slug change → row in `product_slug_redirects`
  → 301 via middleware.
- **Metadata:** Next.js `generateMetadata` per route (title/description/OG/Twitter/
  canonical). `lib/seo.ts` expanded into typed builders (replaces the stub).
- **Structured data (spec §20-21):** `Product`+`Offer`+`AggregateRating`+`Brand`
  (only when real reviews exist — no fake ratings), `LocalBusiness`/`Organization` for
  stores. Rendered via the existing `StructuredData` component.
- **Sitemaps (spec §51):** split `/product-sitemap.xml`, `/store-sitemap.xml`,
  `/category-sitemap.xml` (+ index). Only canonical, indexable, non-empty URLs.
- **robots:** disallow cart/checkout/account/api/internal-search/filter-param combos.
- **Index guardrails:** `stores.is_indexable` / `categories.is_indexable` /
  `products.status` gate inclusion; thin/empty pages set `noindex`. Local pages
  (spec §23) only generated where inventory ≥ threshold. Internal linking
  category↔store↔product and city↔store↔product (spec §50).

## 13. Proposed seller onboarding architecture

Flow (spec §10): account → create store → business info → owner info → KYC → bank →
**Razorpay linked-account creation** (`/api/seller/razorpay/create-account` +
product-config for Route) → verification → admin approval → `ACTIVE`. State machine on
`sellers.status`; a seller's products cannot go `ACTIVE`/receive orders until
`status=ACTIVE` **and** `razorpay_account_id` present. Admin approval + KYC review in the
`(admin)` panel. All KYC/bank writes via service-role server routes, never client.

## 14. Proposed order / shipping architecture

- One **parent order** fans out to N **seller_orders**, each with its own shipping,
  dispatch SLA, status, and **shipment(s)** (spec §4, §31, §57).
- **Shipping is per-seller** (spec §11-12): `shipping_rules` supports FREE / FLAT /
  FREE_ABOVE now; schema (weight/dims/pincode) leaves room for zone/courier later.
- **Dispatch SLA ≠ delivery date** (spec §13): `seller_orders.dispatch_deadline`
  (seller-controlled countdown + overdue state) vs `shipments.estimated_delivery_*`
  (courier). Customer sees both, plus the "**multiple packages**" messaging in cart /
  checkout / confirmation / tracking (spec §5, §58).
- **Returns/refunds at seller-order/item level** (spec §33-34); partial supported;
  reconciled through the ledger against commission + gateway fees.
- **Seller performance** (spec §14) computed from seller_orders into
  `seller_performance`; SLA breaches drive risk level + configurable enforcement.

## 15. Implementation phases & the 3 decisions needed

**Decisions needed before I write code:**
1. **Build location** — fresh Next.js app in `marketplace/`, reusing boutique patterns,
   boutique left untouched (my strong recommendation). *Or* graft onto boutique.
2. **Styling** — spec says *avoid Tailwind unless requested*, but the ecosystem is
   Tailwind 3.4. Tailwind (consistent with ecosystem, faster) vs Bootstrap (literal to
   spec) vs a custom CSS-module design system.
3. **Media storage** — spec says **Supabase Storage**; ecosystem uses **Cloudinary**
   (keys already provisioned). Supabase Storage (literal to spec) vs reuse Cloudinary.

**Phasing** (mirrors spec §54, re-sequenced for a greenfield marketplace):

- **P0 — Foundation:** scaffold app, 3 Supabase clients, design-system primitives,
  marketplace schema migrations + **RLS from day one**, seed categories.
- **P1 — Discovery & catalog:** homepage, store pages, product pages, category pages,
  search/filters, seller product CRUD + variant inventory, SEO metadata + structured
  data + sitemaps.
- **P2 — Cart → checkout → payment:** multi-store cart, server quote/commission engine,
  Razorpay **Route** order + transfers, verify + webhooks + idempotency, inventory
  reservation, parent/seller orders.
- **P3 — Seller settlement & onboarding:** linked-account onboarding, KYC/approval,
  settlements, ledger, finance dashboards.
- **P4 — Fulfilment & trust:** shipments/tracking, dispatch SLA + performance, returns/
  refunds, reviews (verified purchase), coupons, admin panel, notifications, analytics.

No code or destructive change will be made until you approve §15.
