/**
 * Verifies host → tenant resolution.
 *
 * This decides, for every single request, whose store the visitor is looking
 * at. Getting it wrong either breaks the platform or — far worse — serves one
 * tenant's data under another tenant's hostname, so the edge cases are
 * asserted rather than assumed.
 *
 * Run:  NODE_OPTIONS= node scripts/check-tenant.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "sakdha-tenant-"));

fs.writeFileSync(
  path.join(outDir, "resolve.ts"),
  fs.readFileSync(path.join(root, "src/lib/tenant/resolve.ts"), "utf8")
);
execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    path.join(outDir, "resolve.ts"),
    "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler",
  ],
  { stdio: "inherit" }
);

process.env.NEXT_PUBLIC_ROOT_DOMAIN = "sakdha.com";
const { resolveTenantFromHost, slugProblem, storeUrl } = await import(
  new URL(`file:///${path.join(outDir, "resolve.js").replace(/\\/g, "/")}`).href
);

let pass = 0, fail = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
  ok ? pass++ : fail++;
};

const PLATFORM = { kind: "platform" };
const sub = (slug) => ({ kind: "store", by: "subdomain", slug });
const dom = (domain) => ({ kind: "store", by: "domain", domain });

// --- platform ---------------------------------------------------------------
check("apex is the platform", resolveTenantFromHost("sakdha.com"), PLATFORM);
check("www is the platform", resolveTenantFromHost("www.sakdha.com"), PLATFORM);
check("app is the platform", resolveTenantFromHost("app.sakdha.com"), PLATFORM);
check("admin is the platform", resolveTenantFromHost("admin.sakdha.com"), PLATFORM);
check("api is the platform", resolveTenantFromHost("api.sakdha.com"), PLATFORM);
check("missing host falls back to platform", resolveTenantFromHost(null), PLATFORM);
check("vercel previews are the platform", resolveTenantFromHost("sakdha-git-main.vercel.app"), PLATFORM);
check("bare IP is the platform", resolveTenantFromHost("127.0.0.1"), PLATFORM);

// --- subdomain tenants -------------------------------------------------------
check("subdomain resolves to a store", resolveTenantFromHost("lakshmi-fashion.sakdha.com"), sub("lakshmi-fashion"));
check("port is ignored", resolveTenantFromHost("lakshmi-fashion.sakdha.com:3100"), sub("lakshmi-fashion"));
check("host is case-insensitive", resolveTenantFromHost("Lakshmi-Fashion.Sakdha.COM"), sub("lakshmi-fashion"));
// A nested label must not be mistaken for a tenant — it could be used to
// impersonate a store under a hostname the store does not control.
check("nested subdomain is NOT a tenant", resolveTenantFromHost("evil.lakshmi.sakdha.com"), PLATFORM);

// --- custom domains ----------------------------------------------------------
check("custom domain resolves by domain", resolveTenantFromHost("lakshmifashion.com"), dom("lakshmifashion.com"));
check("custom domain with www is still a domain lookup", resolveTenantFromHost("www.lakshmifashion.com"), dom("www.lakshmifashion.com"));

// --- local development --------------------------------------------------------
process.env.NEXT_PUBLIC_ROOT_DOMAIN = "localhost";
check("localhost is the platform", resolveTenantFromHost("localhost:3100"), PLATFORM);
check("store.localhost resolves in dev", resolveTenantFromHost("lakshmi.localhost:3100"), sub("lakshmi"));

// --- slug rules ----------------------------------------------------------------
check("valid slug accepted", slugProblem("lakshmi-fashion"), null);
check("too short rejected", Boolean(slugProblem("ab")), true);
check("too long rejected", Boolean(slugProblem("a".repeat(51))), true);
check("uppercase rejected", Boolean(slugProblem("Lakshmi")), true);
check("spaces rejected", Boolean(slugProblem("lakshmi fashion")), true);
check("leading hyphen rejected", Boolean(slugProblem("-lakshmi")), true);
check("trailing hyphen rejected", Boolean(slugProblem("lakshmi-")), true);
check("double hyphen rejected", Boolean(slugProblem("lakshmi--fashion")), true);
check("underscore rejected", Boolean(slugProblem("lakshmi_fashion")), true);
check("dots rejected (would create a nested host)", Boolean(slugProblem("a.b")), true);

// --- URL building ----------------------------------------------------------------
process.env.NEXT_PUBLIC_ROOT_DOMAIN = "sakdha.com";
check("store URL uses https in production", storeUrl("lakshmi"), "https://lakshmi.sakdha.com");

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
