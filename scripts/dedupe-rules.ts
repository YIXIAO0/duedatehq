/**
 * One-off: remove duplicate deadline_rules rows introduced when the seed
 * script ran without a unique-target onConflict. Keeps the oldest copy
 * per (jurisdiction_code, form_code, title, version) natural key and
 * re-points any deadline_instances that referenced a dupe to the keeper.
 *
 * Safe to run multiple times — idempotent (nothing happens if there are
 * no dupes).
 *
 *   pnpm tsx scripts/dedupe-rules.ts           → dry run
 *   pnpm tsx scripts/dedupe-rules.ts --yes     → actually delete
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });
const DRY_RUN = !process.argv.includes("--yes");
const db = drizzle(neon(process.env.DATABASE_URL!));

async function main() {
  // Find (keeper, dupes[]) groups. Keeper = oldest row per natural key.
  const dupeGroups = await db.execute<{
    keeper_id: string;
    dupe_ids: string[];
    form_code: string;
    jurisdiction_code: string;
  }>(sql`
    WITH groups AS (
      SELECT
        jurisdiction_code, form_code, title, version,
        (array_agg(id ORDER BY created_at ASC))[1] AS keeper_id,
        (array_agg(id ORDER BY created_at ASC))[2:] AS dupe_ids
      FROM deadline_rules
      GROUP BY jurisdiction_code, form_code, title, version
      HAVING COUNT(*) > 1
    )
    SELECT keeper_id, dupe_ids, form_code, jurisdiction_code
    FROM groups
  `);

  console.log(`Duplicate groups: ${dupeGroups.rows.length}`);
  if (dupeGroups.rows.length === 0) {
    console.log("Nothing to clean.");
    return;
  }

  let totalDupes = 0;
  for (const g of dupeGroups.rows) totalDupes += g.dupe_ids.length;
  console.log(`Rows to remove: ${totalDupes}\n`);

  for (const g of dupeGroups.rows) {
    console.log(
      `  ${g.jurisdiction_code} / ${g.form_code}: keep ${g.keeper_id.slice(-8)}, remove ${g.dupe_ids.length}`,
    );
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — re-run with --yes to actually delete.");
    return;
  }

  console.log("\nReassigning deadline_instances + deleting dupes…");
  let reassigned = 0;
  let deleted = 0;

  // Process per-ID — Drizzle's neon-http binds arrays as N spread params,
  // not a Postgres array literal, so `ANY($1::text[])` fails parse. Single
  // string params work fine. Each group has 1 dupe in our dataset.
  for (const g of dupeGroups.rows) {
    for (const dupeId of g.dupe_ids) {
      // 1. Move any instances that point at this dupe → keeper.
      const moved = await db.execute<{ count: number }>(sql`
        WITH updated AS (
          UPDATE deadline_instances
          SET rule_id = ${g.keeper_id}, updated_at = NOW()
          WHERE rule_id = ${dupeId}
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM updated
      `);
      reassigned += Number(moved.rows[0]?.count ?? 0);

      // 2. Delete the dupe.
      const killed = await db.execute<{ count: number }>(sql`
        WITH d AS (
          DELETE FROM deadline_rules
          WHERE id = ${dupeId}
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM d
      `);
      deleted += Number(killed.rows[0]?.count ?? 0);
    }
  }

  console.log(
    `\n✓ Reassigned ${reassigned} deadline_instances.\n✓ Deleted ${deleted} duplicate rules.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
