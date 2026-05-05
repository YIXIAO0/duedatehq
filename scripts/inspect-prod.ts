/**
 * Read-only inspection of production DB before applying pending migrations.
 * Reports: table presence (subtasks/notifications), status column presence,
 * row counts, status value distribution, and lingering 0008 artifacts
 * (deadline_status enum + index renames).
 *
 *   pnpm dotenv -e .env.production.local -- tsx scripts/inspect-prod.ts
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.production.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(url);

async function main() {
  console.log("=== Production DB inspection ===\n");

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('deadline_instances', 'deadline_subtasks', 'notifications', '__drizzle_migrations')
    ORDER BY table_name
  `;
  console.log("Existing target tables:");
  for (const t of tables) console.log(`  ✓ ${t.table_name}`);

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'deadline_instances'
      AND column_name = 'status'
  `;
  console.log("\ndeadline_instances.status column:");
  console.log(cols.length === 0 ? "  ✓ dropped" : "  ✗ STILL PRESENT");

  const enums = await sql`
    SELECT typname FROM pg_type
    WHERE typname IN ('deadline_status', 'notification_kind')
    ORDER BY typname
  `;
  console.log("\nEnum types:");
  const enumNames = enums.map((e) => e.typname);
  console.log(enumNames.includes("deadline_status") ? "  ✗ deadline_status STILL PRESENT (0008 was supposed to drop)" : "  ✓ deadline_status dropped");
  console.log(enumNames.includes("notification_kind") ? "  ✓ notification_kind present (0010)" : "  ✗ notification_kind missing");

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'deadline_instances'
      AND indexname IN (
        'deadline_instances_org_status_idx',
        'deadline_instances_org_completed_idx',
        'deadline_instances_org_due_idx'
      )
    ORDER BY indexname
  `;
  console.log("\ndeadline_instances indexes (after 0008 rename):");
  const idxNames = idx.map((i) => i.indexname);
  console.log(idxNames.includes("deadline_instances_org_status_idx") ? "  ✗ org_status_idx STILL PRESENT (should be dropped)" : "  ✓ org_status_idx dropped");
  console.log(idxNames.includes("deadline_instances_org_completed_idx") ? "  ✓ org_completed_idx present" : "  ✗ org_completed_idx missing");
  console.log(idxNames.includes("deadline_instances_org_due_idx") ? "  ✓ org_due_idx present" : "  ✗ org_due_idx missing");

  const orgs = await sql`SELECT COUNT(*)::int AS c FROM organizations`;
  const users = await sql`SELECT COUNT(*)::int AS c FROM users`;
  const clients = await sql`SELECT COUNT(*)::int AS c FROM clients`;
  const di = await sql`SELECT COUNT(*)::int AS c FROM deadline_instances`;
  console.log(`\nDataset size:`);
  console.log(`  organizations: ${orgs[0].c}`);
  console.log(`  users:         ${users[0].c}`);
  console.log(`  clients:       ${clients[0].c}`);
  console.log(`  deadlines:     ${di[0].c}`);
}

main().catch((e) => {
  console.error("Inspection failed:", e);
  process.exit(1);
});
