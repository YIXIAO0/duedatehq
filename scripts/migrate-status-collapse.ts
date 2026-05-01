/**
 * One-shot data migration — collapses 8 deadline statuses to 4.
 *
 * MUST be run BEFORE the drizzle migration that drops the enum values,
 * otherwise `ALTER TYPE` fails on rows still holding the old values.
 *
 * What it does:
 *   - status='extended'       → is_extended=true, status=in_progress
 *   - status='ready_to_file'  → status=in_progress
 *   - status='missed'         → status=in_progress (overdue is computed)
 *   - status='not_applicable' → DELETE (this rule doesn't apply to entity)
 *
 * Idempotent: safe to re-run. Never mutates rows that are already in
 * the new shape.
 *
 * Run: pnpm tsx scripts/migrate-status-collapse.ts
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = neon(url);

  // 0) Make sure is_extended column exists. We add it here rather than
  //    in a drizzle migration because the steps below depend on it,
  //    and drizzle-kit's enum-altering migration will fail if any rows
  //    still hold a dropped enum value. Idempotent via IF NOT EXISTS.
  await sql`
    ALTER TABLE deadline_instances
      ADD COLUMN IF NOT EXISTS is_extended boolean NOT NULL DEFAULT false
  `;
  console.log("✓ Ensured is_extended column exists");

  // 1) Mark every 'extended' row as is_extended=true so we don't lose
  //    the signal when status flips to in_progress next.
  const flagged = (await sql`
    UPDATE deadline_instances
       SET is_extended = true,
           updated_at = NOW()
     WHERE status::text = 'extended'
       AND is_extended = false
    RETURNING id
  `) as Array<{ id: string }>;
  console.log(`✓ Flagged ${flagged.length} extended rows as is_extended=true`);

  // 2) Collapse all 3 dropped workflow values to in_progress.
  //    'extended' rows keep their is_extended=true from step 1.
  const collapsed = (await sql`
    UPDATE deadline_instances
       SET status = 'in_progress',
           updated_at = NOW()
     WHERE status::text IN ('extended', 'ready_to_file', 'missed')
    RETURNING id, status::text AS status
  `) as Array<{ id: string; status: string }>;
  console.log(`✓ Collapsed ${collapsed.length} rows to in_progress`);

  // 3) Delete not_applicable rows — they should never have existed.
  const deleted = (await sql`
    DELETE FROM deadline_instances
     WHERE status::text = 'not_applicable'
    RETURNING id
  `) as Array<{ id: string }>;
  console.log(`✓ Deleted ${deleted.length} not_applicable rows`);

  // 4) Verify no rows remain with dropped values.
  const remaining = (await sql`
    SELECT status::text AS status, COUNT(*)::int AS count
      FROM deadline_instances
     WHERE status::text IN ('extended', 'ready_to_file', 'missed', 'not_applicable')
     GROUP BY status::text
  `) as Array<{ status: string; count: number }>;

  if (remaining.length > 0) {
    console.error("✗ Some rows still hold dropped statuses:");
    for (const r of remaining) console.error(`    ${r.status}: ${r.count}`);
    process.exit(1);
  }

  console.log("✓ All rows now use the 4-status model. Safe to run drizzle migration.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
