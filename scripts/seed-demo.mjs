/**
 * Seeds ONE demo seller, store and a handful of products so the P1 discovery
 * surfaces (grid, PDP, gallery, variant picker, facets, sitemaps) have real
 * data to render.
 *
 * Run:  NODE_OPTIONS= node scripts/seed-demo.mjs
 *
 * Notes:
 *  • Uses the service-role key, so it bypasses RLS. Server-side only, never
 *    import any of this into the app.
 *  • Idempotent: re-running updates the same rows (keyed by slug / email)
 *    instead of duplicating them.
 *  • Ratings are left at zero on purpose. Reviews are verified-purchase only,
 *    and fake aggregateRating in JSON-LD is a manual-action risk.
 *  • sellers.razorpay_account_id stays NULL — there is no real Route linked
 *    account, and the app treats "no linked account" as "cannot receive
 *    orders", which is the honest state for demo data.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
const envPath = path.resolve(process.cwd(), ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("Missing .env.local — run from the marketplace/ directory.");
  process.exit(1);
}
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = "product-media";
const DEMO_EMAIL = "demo-seller@sakdha.test";
const STORE_SLUG = "indigo-loom";

const die = (label, error) => {
  console.error(`\n✗ ${label}:`, error?.message ?? error);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// PNG generation — a vertical gradient, so every product gets a distinct,
// obviously-placeholder image without shipping binary fixtures in the repo.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, shade) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = shade(x, y);
      raw[o++] = Math.max(0, Math.min(255, Math.round(r)));
      raw[o++] = Math.max(0, Math.min(255, Math.round(g)));
      raw[o++] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

/** Deterministic value noise, so re-running the seed produces identical files. */
function noise(x, y, seed = 1) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

function gradientPng(width, height, top, bottom) {
  return encodePng(width, height, (x, y) => mix(top, bottom, y / (height - 1)));
}

/**
 * Draws a textile-ish swatch: base gradient, a weave texture, a motif chosen
 * per garment type, and a vignette. These are still obviously placeholders —
 * the point is that each product reads as a distinct fabric rather than six
 * identical gradients, so the grid, gallery and thumbnails are judgeable.
 */
function fabricPng(width, height, art, view) {
  const [light, dark] = art.colours;
  const accent = art.accent ?? [214, 184, 108];

  return encodePng(width, height, (x, y) => {
    const u = x / (width - 1);
    const v = y / (height - 1);

    // Base: soft diagonal gradient, shifted per view so the three images differ.
    let c = mix(light, dark, Math.min(1, Math.max(0, v * 0.85 + u * 0.15 + view * 0.06)));

    // Woven texture — fine alternating warp/weft.
    const weave = ((x % 6 < 3 ? 1 : 0) ^ (y % 6 < 3 ? 1 : 0)) ? 1.035 : 0.965;
    c = c.map((ch) => ch * weave);

    switch (art.motif) {
      case "zari": {
        // Broad border band along the bottom plus narrow selvedge stripes.
        const bandTop = 0.74 + view * 0.03;
        if (v > bandTop) {
          const inBand = (v - bandTop) / (1 - bandTop);
          c = mix(c, accent, 0.55 + 0.35 * Math.sin(inBand * Math.PI));
          if (Math.floor(y / 9) % 2 === 0) c = c.map((ch) => ch * 1.07);
        } else if (u < 0.045 || u > 0.955) {
          c = mix(c, accent, 0.5);
        }
        break;
      }
      case "striped": {
        const band = Math.floor(x / 34) % 3;
        if (band === 0) c = c.map((ch) => ch * 0.82);
        else if (band === 2) c = mix(c, light, 0.35);
        break;
      }
      case "embroidered": {
        // Scattered chikankari-like knots, denser toward the yoke.
        const gx = Math.round(x / 46), gy = Math.round(y / 46);
        const jx = (noise(gx, gy, 3) - 0.5) * 30;
        const jy = (noise(gx, gy, 7) - 0.5) * 30;
        const dx = x - (gx * 46 + jx), dy = y - (gy * 46 + jy);
        const d = Math.hypot(dx, dy);
        const density = v < 0.42 ? 1 : 0.35;
        if (d < 7 * density) c = mix(c, [255, 255, 252], 0.55 * density);
        else if (d < 10 * density) c = mix(c, [255, 255, 252], 0.2 * density);
        break;
      }
      case "tiered": {
        // Three gathered tiers with a shaded seam between them.
        const tier = v < 0.34 ? 0 : v < 0.67 ? 1 : 2;
        c = c.map((ch) => ch * (1 - tier * 0.06));
        const seam = Math.abs(v - 0.34) < 0.006 || Math.abs(v - 0.67) < 0.006;
        if (seam) c = c.map((ch) => ch * 0.74);
        // Vertical gathers.
        c = c.map((ch) => ch * (1 + 0.05 * Math.sin(x / 11 + tier)));
        break;
      }
      case "radial": {
        // Concentric jhumka domes on a flat-lay ground.
        const cx = width / 2, cy = height * (0.44 + view * 0.03);
        const d = Math.hypot(x - cx, y - cy) / (width * 0.34);
        if (d < 1) {
          const ring = Math.sin(d * 16) * 0.5 + 0.5;
          c = mix(mix(accent, dark, d * 0.75), light, ring * 0.3);
        }
        break;
      }
      default: {
        // Plain weave with a slub slub texture.
        if (noise(Math.floor(x / 3), Math.floor(y / 3), 11) > 0.93) {
          c = c.map((ch) => ch * 1.06);
        }
        break;
      }
    }

    // Film grain, then a vignette so the swatch has some depth.
    const grain = (noise(x, y, 17) - 0.5) * 6;
    c = c.map((ch) => ch + grain);
    const vig = 1 - 0.3 * Math.hypot(u - 0.5, v - 0.5) ** 1.7;
    return c.map((ch) => ch * vig);
  });
}

async function uploadImage(objectPath, buffer) {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(objectPath, buffer, { contentType: "image/png", upsert: true });
  if (error) die(`upload ${objectPath}`, error);
  return db.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

// ---------------------------------------------------------------------------
// demo catalogue
// ---------------------------------------------------------------------------
const APPAREL_SIZES = [
  { value: "S", qty: 4 },
  { value: "M", qty: 7 },
  { value: "L", qty: 2 },
  { value: "XL", qty: 0 }, // deliberately sold out — exercises the disabled state
];

const PRODUCTS = [
  {
    slug: "kanjivaram-silk-saree-deep-maroon",
    name: "Kanjivaram Silk Saree — Deep Maroon",
    category: "sarees",
    price: 489900,
    compare_at_price: 650000,
    short_description: "Handwoven pure silk Kanjivaram with a contrast zari border.",
    description:
      "Woven on a traditional pit loom in Kanchipuram, this saree pairs a deep maroon body with a contrast mustard zari border.\nComes with an unstitched blouse piece of 0.8m.",
    fabric: "silk",
    occasion: "wedding",
    gender: "women",
    pattern: "zari",
    art: { colours: [[138, 38, 56], [62, 12, 24]], accent: [214, 184, 108], motif: "zari" },
    sizes: null,
    weight_grams: 700,
  },
  {
    slug: "handloom-cotton-saree-indigo-stripe",
    name: "Handloom Cotton Saree — Indigo Stripe",
    category: "cotton-sarees",
    price: 149900,
    compare_at_price: 199900,
    short_description: "Breathable handloom cotton with a woven indigo stripe.",
    description:
      "A lightweight six-yard handloom cotton saree, naturally dyed with indigo.\nSoftens beautifully with every wash.",
    fabric: "cotton",
    occasion: "daily",
    gender: "women",
    pattern: "striped",
    art: { colours: [[86, 108, 158], [26, 38, 72]], accent: [226, 232, 240], motif: "striped" },
    sizes: null,
    weight_grams: 450,
  },
  {
    slug: "chikankari-anarkali-kurti-ivory",
    name: "Chikankari Anarkali Kurti — Ivory",
    category: "kurtis",
    price: 219900,
    compare_at_price: 289900,
    short_description: "Hand-embroidered Lucknowi chikankari on soft cotton mul.",
    description:
      "Floor-length anarkali in cotton mul with hand-done chikankari across the yoke.\nFully lined bodice; side pockets.",
    fabric: "cotton",
    occasion: "festive",
    gender: "women",
    pattern: "embroidered",
    art: { colours: [[246, 242, 232], [206, 196, 176]], accent: [255, 255, 252], motif: "embroidered" },
    sizes: APPAREL_SIZES,
    weight_grams: 380,
  },
  {
    slug: "tiered-midi-dress-terracotta",
    name: "Tiered Midi Dress — Terracotta",
    category: "dresses",
    price: 189900,
    compare_at_price: null,
    short_description: "Three-tiered midi in textured cotton, with pockets.",
    description:
      "An easy tiered midi cut from textured cotton dobby.\nElasticated waist, deep side pockets, midi length.",
    fabric: "cotton",
    occasion: "casual",
    gender: "women",
    pattern: "solid",
    art: { colours: [[206, 116, 84], [138, 62, 42]], accent: [240, 196, 168], motif: "tiered" },
    sizes: APPAREL_SIZES,
    weight_grams: 320,
  },
  {
    slug: "linen-blend-shirt-sage",
    name: "Linen Blend Shirt — Sage",
    category: "mens-shirts",
    price: 169900,
    compare_at_price: 209900,
    short_description: "Half-sleeve linen blend shirt with a camp collar.",
    description:
      "A relaxed camp-collar shirt in a breathable 55% linen blend.\nCoconut buttons; unlined.",
    fabric: "linen",
    occasion: "casual",
    gender: "men",
    pattern: "solid",
    art: { colours: [[164, 178, 146], [96, 112, 84]], accent: [226, 230, 214], motif: "weave" },
    sizes: APPAREL_SIZES,
    weight_grams: 260,
  },
  {
    slug: "oxidised-silver-jhumka-earrings",
    name: "Jhumka Earrings — Oxidised Silver",
    category: "accessories",
    price: 79900,
    compare_at_price: 99900,
    short_description: "Lightweight oxidised jhumkas with pearl drops.",
    description:
      "Classic dome jhumkas in oxidised white metal, finished with freshwater pearl drops.\nNickel-free posts.",
    fabric: null,
    occasion: "festive",
    gender: "women",
    pattern: null,
    art: { colours: [[196, 198, 204], [78, 80, 88]], accent: [222, 224, 230], motif: "radial" },
    sizes: null, // simple product, no variants
    weight_grams: 40,
  },
];

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Seeding demo data into ${SUPABASE_URL}\n`);

  // 1. Auth user -------------------------------------------------------------
  let userId;
  {
    const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) die("listUsers", error);
    const existing = list.users.find((u) => u.email === DEMO_EMAIL);
    if (existing) {
      userId = existing.id;
      console.log(`✓ auth user exists        ${DEMO_EMAIL}`);
    } else {
      const { data, error: createError } = await db.auth.admin.createUser({
        email: DEMO_EMAIL,
        password: `demo-${Math.random().toString(36).slice(2)}-Aa1!`,
        email_confirm: true,
        user_metadata: { full_name: "Indigo Loom", role: "seller" },
      });
      if (createError) die("createUser", createError);
      userId = data.user.id;
      console.log(`✓ auth user created      ${DEMO_EMAIL}`);
    }
  }

  // The on_auth_user_created trigger inserts the profile; make sure the role
  // reflects "seller" even for a pre-existing user.
  {
    const { error } = await db
      .from("profiles")
      .upsert(
        { id: userId, email: DEMO_EMAIL, full_name: "Indigo Loom", role: "seller" },
        { onConflict: "id" }
      );
    if (error) die("profile upsert", error);
    console.log("✓ profile role = seller");
  }

  // 2. Seller ---------------------------------------------------------------
  let sellerId;
  {
    const { data: found, error } = await db
      .from("sellers")
      .select("id")
      .eq("owner_profile_id", userId)
      .maybeSingle();
    if (error) die("seller lookup", error);

    if (found) {
      sellerId = found.id;
      console.log("✓ seller exists");
    } else {
      const { data, error: insertError } = await db
        .from("sellers")
        .insert({
          owner_profile_id: userId,
          legal_name: "Indigo Loom Handlooms Pvt Ltd",
          display_name: "Indigo Loom",
          status: "ACTIVE",
          risk_level: "GOOD",
          onboarding_step: "complete",
          kyc_json: { demo: true },
        })
        .select("id")
        .single();
      if (insertError) die("seller insert", insertError);
      sellerId = data.id;
      console.log("✓ seller created");
    }
  }

  // 3. Storage bucket -------------------------------------------------------
  {
    const { data: buckets, error } = await db.storage.listBuckets();
    if (error) die("listBuckets", error);
    if (!buckets.some((b) => b.name === BUCKET)) {
      const { error: createError } = await db.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: "5MB",
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/avif"],
      });
      if (createError) die("createBucket", createError);
      console.log(`✓ bucket created         ${BUCKET} (public)`);
    } else {
      console.log(`✓ bucket exists          ${BUCKET}`);
    }
  }

  // 4. Store ----------------------------------------------------------------
  const logoUrl = await uploadImage(
    `${STORE_SLUG}/logo.png`,
    gradientPng(256, 256, [42, 62, 112], [18, 28, 56])
  );
  const coverUrl = await uploadImage(
    `${STORE_SLUG}/cover.png`,
    gradientPng(1600, 500, [56, 82, 142], [20, 32, 62])
  );

  let storeId;
  {
    const { data, error } = await db
      .from("stores")
      .upsert(
        {
          seller_id: sellerId,
          slug: STORE_SLUG,
          name: "Indigo Loom",
          logo_url: logoUrl,
          cover_url: coverUrl,
          description:
            "Handloom saris, kurtis and easy everyday pieces, woven and stitched in Tamil Nadu. Small batches, natural dyes.",
          city: "Coimbatore",
          state: "Tamil Nadu",
          pincode: "641001",
          return_policy: "7-day return on unworn items with tags intact.",
          shipping_info: "Free shipping above ₹1,499. Dispatched within 48 hours.",
          social_json: { instagram: "indigoloom" },
          is_indexable: true,
        },
        { onConflict: "slug" }
      )
      .select("id")
      .single();
    if (error) die("store upsert", error);
    storeId = data.id;
    console.log(`✓ store upserted         /store/${STORE_SLUG}`);
  }

  // 5. Shipping rule (unique per seller) ------------------------------------
  {
    const { error } = await db.from("shipping_rules").upsert(
      {
        seller_id: sellerId,
        type: "FREE_ABOVE",
        flat_fee: 9900,
        free_above_threshold: 149900,
        dispatch_sla_hours: 48,
      },
      { onConflict: "seller_id" }
    );
    if (error) die("shipping_rules upsert", error);
    console.log("✓ shipping rule          FREE_ABOVE ₹1,499 (else ₹99), 48h SLA");
  }

  // 6. Categories -----------------------------------------------------------
  const { data: categoryRows, error: categoryError } = await db
    .from("categories")
    .select("id, slug");
  if (categoryError) die("categories", categoryError);
  const categoryBySlug = new Map(categoryRows.map((c) => [c.slug, c.id]));

  // 7. Products -------------------------------------------------------------
  let created = 0;
  for (const spec of PRODUCTS) {
    const categoryId = categoryBySlug.get(spec.category);
    if (!categoryId) die("category lookup", `no category with slug "${spec.category}"`);

    const { data: product, error } = await db
      .from("products")
      .upsert(
        {
          store_id: storeId,
          seller_id: sellerId,
          slug: spec.slug,
          name: spec.name,
          short_description: spec.short_description,
          description: spec.description,
          category_id: categoryId,
          price: spec.price,
          compare_at_price: spec.compare_at_price,
          gender: spec.gender,
          fabric: spec.fabric,
          pattern: spec.pattern,
          occasion: spec.occasion,
          fit: spec.sizes ? "regular" : null,
          wash_care: spec.fabric === "silk" ? "Dry clean only" : "Gentle machine wash, cold",
          weight_grams: spec.weight_grams,
          status: "ACTIVE",
          tags: ["demo"],
        },
        { onConflict: "slug" }
      )
      .select("id")
      .single();
    if (error) die(`product upsert ${spec.slug}`, error);

    // Media — replace wholesale so re-runs don't accumulate duplicates.
    await db.from("product_media").delete().eq("product_id", product.id);
    const media = [];
    for (let i = 0; i < 3; i++) {
      const url = await uploadImage(
        `${STORE_SLUG}/${spec.slug}-${i + 1}.png`,
        fabricPng(900, 1200, spec.art, i)
      );
      media.push({ product_id: product.id, url, type: "image", position: i });
    }
    const { error: mediaError } = await db.from("product_media").insert(media);
    if (mediaError) die(`media insert ${spec.slug}`, mediaError);

    // Options + variants
    await db.from("product_options").delete().eq("product_id", product.id);
    await db.from("product_variants").delete().eq("product_id", product.id);

    if (spec.sizes) {
      const { error: optionError } = await db
        .from("product_options")
        .insert({ product_id: product.id, name: "Size", position: 0 });
      if (optionError) die(`option insert ${spec.slug}`, optionError);

      const variants = spec.sizes.map((size, i) => ({
        product_id: product.id,
        sku: `${spec.slug.slice(0, 18).toUpperCase().replace(/-/g, "")}-${size.value}`,
        option_values_json: { Size: size.value },
        // One size carries a surcharge, to prove price_override flows through.
        price_override: size.value === "XL" ? spec.price + 10000 : null,
        inventory_qty: size.qty,
        reserved_qty: i === 1 ? 1 : 0, // a held unit, so available < inventory
        is_active: true,
      }));
      const { error: variantError } = await db.from("product_variants").insert(variants);
      if (variantError) die(`variant insert ${spec.slug}`, variantError);
    }

    created++;
    console.log(`✓ product ${created}/${PRODUCTS.length}            /product/${spec.slug}`);
  }

  // 8. Denormalised counter the store card and sitemap gate on ---------------
  {
    const { count, error } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .eq("status", "ACTIVE");
    if (error) die("product count", error);
    const { error: updateError } = await db
      .from("stores")
      .update({ product_count: count ?? 0 })
      .eq("id", storeId);
    if (updateError) die("store product_count", updateError);
    console.log(`✓ store.product_count    ${count}`);
  }

  console.log("\nDone. Try:");
  console.log("  /store/indigo-loom");
  console.log("  /product/chikankari-anarkali-kurti-ivory   (sizes, one sold out)");
  console.log("  /category/sarees                           (parent + cotton-sarees child)");
  console.log("  /product-sitemap.xml");
}

main().catch((e) => die("unexpected", e));
