/**
 * One-off: clear every row in `announcements`.
 *
 * Use case: the workflow stored items with default classification
 * because AI Gateway was unavailable. After fixing AI, we want the
 * next scrape to re-process those items with real classification —
 * but the unique (source, external_id) index makes the insert a
 * no-op. Easiest fix: delete and let the next scrape re-populate.
 *
 *   pnpm tsx scripts/clear-announcements.ts          → dry run (count)
 *   pnpm tsx scripts/clear-announcements.ts --yes    → actually delete
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--yes");

const db = drizzle(neon(process.env.DATABASE_URL));

async function main() {
  const count = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM announcements`,
  );
  const n = Number(count.rows[0]?.n ?? 0);
  console.log(`Current announcements: ${n}`);

  if (n === 0) {
    console.log("Nothing to clear.");
    return;
  }

  if (DRY_RUN) {
    console.log("DRY RUN — re-run with --yes to actually delete.");
    return;
  }

  await db.execute(sql`DELETE FROM announcements`);
  console.log(`✓ Deleted ${n} rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
