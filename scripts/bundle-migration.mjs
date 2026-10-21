/**
 * Wraps a single migration in a transaction for pasting into the SQL Editor.
 *
 * There is no DB password or personal access token for `supabase db push`, so
 * applying DDL means pasting it by hand. Pasting a migration bare is risky: if
 * it fails halfway the schema is left part-migrated with no record of where it
 * stopped. A `begin/commit` wrapper makes the paste all-or-nothing.
 *
 * This deliberately bundles ONE migration. `bundle_all_migrations.sql` exists
 * for first-time installs only and cannot be re-run — its `create table`
 * statements are unguarded, so it fails on the first already-existing table.
 *
 * Run:  NODE_OPTIONS= node scripts/bundle-migration.mjs 0012
 */

import fs from "node:fs";
import path from "node:path";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/bundle-migration.mjs <migration-number, e.g. 0012>");
  process.exit(1);
}

const migDir = path.join(process.cwd(), "supabase", "migrations");
const match = fs.readdirSync(migDir).find((f) => f.startsWith(`${arg}_`) && f.endsWith(".sql"));
if (!match) {
  console.error(`No migration starting with "${arg}_" in supabase/migrations/`);
  process.exit(1);
}

const body = fs.readFileSync(path.join(migDir, match), "utf8");
const out = path.join(process.cwd(), "supabase", `apply_${arg}.sql`);

fs.writeFileSync(
  out,
  [
    "-- GENERATED — do not edit. Paste this whole file into the Supabase SQL Editor.",
    `-- Source: supabase/migrations/${match}`,
    `-- Applies ONLY ${arg}, atomically. Earlier migrations must already be applied.`,
    `-- Regenerate with: npm run bundle -- ${arg}`,
    "",
    "begin;",
    "",
    body.trimEnd(),
    "",
    "commit;",
    "",
  ].join("\n")
);

console.log(`Wrote supabase/apply_${arg}.sql from ${match}`);
