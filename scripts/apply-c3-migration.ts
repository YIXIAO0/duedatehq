/**
 * One-off — apply drizzle/0010_mixed_king_bedlam.sql (C-3 notifications).
 *
 * Reason: drizzle-kit push hard-requires a TTY in strict mode. We don't
 * track migrations via __drizzle_migrations (team uses push). This is the
 * standard escape hatch for repeated CI / scripted apply.
 *
 * Idempotent: each statement uses CREATE ... or ALTER TABLE ADD CONSTRAINT,
 * which throws on second run — so we wrap in try/catch and skip 42P07
 * (relation exists) / 42710 (object exists) errors.
 *
 *   pnpm tsx scripts/apply-c3-migration.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set in .env.local");
  process.exit(1);
}

const sql = neon(url);
const migrationPath = resolve(process.cwd(), "drizzle/0010_mixed_king_bedlam.sql");
const raw = readFileSync(migrationPath, "utf8");

const statements = raw
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  console.log(`Applying ${statements.length} statements from 0010_mixed_king_bedlam.sql`);

  let applied = 0;
  let skipped = 0;

  for (const [i, stmt] of statements.entries()) {
    try {
      await sql.query(stmt);
      applied++;
      console.log(`  ✓ [${i + 1}/${statements.length}] applied`);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      // 42P07 = relation already exists, 42710 = object already exists,
      // 42701 = column already exists. Treat as no-op.
      if (e.code === "42P07" || e.code === "42710" || e.code === "42701") {
        skipped++;
        console.log(`  · [${i + 1}/${statements.length}] already exists — skip`);
      } else {
        console.error(`  ✗ [${i + 1}/${statements.length}] failed`, e.code, e.message);
        throw err;
      }
    }
  }

  console.log(`\nDone: ${applied} applied, ${skipped} skipped (already existed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
