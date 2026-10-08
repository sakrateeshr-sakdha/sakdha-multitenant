/**
 * Walks every internal path referenced anywhere in src/ and requests it.
 *
 * Deliberately NOT limited to `href="..."` — footer and nav links are built
 * from arrays of tuples, and an href-only scan silently misses them. This
 * collects every string literal that looks like a site path.
 *
 * Run (with the app serving):  NODE_OPTIONS= node scripts/check-links.mjs [baseUrl]
 */

import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3100";
const root = path.resolve(process.cwd(), "src");

/** Any "/..." or `/...` string literal, minus template-interpolated ones. */
const PATH_LITERAL = /["'`](\/[A-Za-z0-9\-_/#?=&.%]*)["'`]/g;

const SKIP = [
  /^\/_next/,
  /^\/api\//, // exercised separately; many are POST-only
  /\$\{/, // dynamic segment
  /^\/storage\//,
  /^\/v\d+\//, // third-party API paths (Razorpay), not site routes
  /\.(png|jpg|jpeg|svg|webp|ico|css|js)$/,
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const found = new Map(); // path -> Set of files

for (const file of walk(root)) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(PATH_LITERAL)) {
    const candidate = match[1];
    if (candidate === "/" && !/href/.test(match.input.slice(Math.max(0, match.index - 12), match.index))) {
      continue; // a bare "/" is usually a separator, not a link
    }
    if (SKIP.some((re) => re.test(candidate))) continue;
    const rel = path.relative(root, file);
    if (!found.has(candidate)) found.set(candidate, new Set());
    found.get(candidate).add(rel);
  }
}

const paths = [...found.keys()].sort();
console.log(`Checking ${paths.length} internal paths against ${base}\n`);

let broken = 0;
for (const p of paths) {
  const url = `${base}${p.split("#")[0]}`;
  let status;
  try {
    const response = await fetch(url, { redirect: "manual" });
    status = response.status;
  } catch {
    status = "ERR";
  }

  // 3xx is fine: auth-gated pages redirect to /login by design.
  const ok = status !== 404 && status !== "ERR" && status < 500;
  if (!ok) {
    broken++;
    console.log(`${status}  ${p}`);
    console.log(`      referenced in: ${[...found.get(p)].join(", ")}`);
  } else {
    console.log(`${status}  ${p}`);
  }
}

console.log(`\n${paths.length - broken} reachable, ${broken} broken`);
process.exit(broken ? 1 : 0);
