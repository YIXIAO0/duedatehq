/**
 * Wipe tenant data for repeated import / testing.
 *
 *   pnpm db:clean          → dry run. Shows counts of what WOULD be deleted.
 *   pnpm db:clean --yes    → actually delete.
 *
 * What gets wiped:
 *   clients / entities / deadline_instances / reminders_sent /
 *   audit_events / memberships / organizations / users
 *
 * What is PRESERVED:
 *   deadline_rules — our seeded 46-row catalog. If you want to re-seed,
 *   run `pnpm db:seed` (it's idempotent).
 *
 * After running, just reload the app in browser — getCurrentContext() will
 * automatically rebuild your user + org on the next page load (no need to
 * sign out of Clerk).
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error(
    "❌ DATABASE_URL not set. Run `vercel env pull .env.local` first.",
  );
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--yes");

const db = drizzle(neon(process.env.DATABASE_URL), { schema });

// Order matters: children first to avoid FK violations (though we CASCADE
// in schema so it'd work either way — this order makes the output readable).
const TABLES = [
  { name: "reminders_sent", table: schema.remindersSent },
  { name: "deadline_instances", table: schema.deadlineInstances },
  { name: "audit_events", table: schema.auditEvents },
  { name: "entities", table: schema.entities },
  { name: "clients", table: schema.clients },
  { name: "memberships", table: schema.memberships },
  { name: "organizations", table: schema.organizations },
  { name: "users", table: schema.users },
] as const;

async function main() {
  // ---- Count what's there ----
  const counts: Array<{ name: string; count: number }> = [];
  for (const { name, table } of TABLES) {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(table);
    counts.push({ name, count: rows[0]?.c ?? 0 });
  }

  // Also report the preserved table(s)
  const rulesCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.deadlineRules);
  const totalTenantRows = counts.reduce((a, b) => a + b.count, 0);

  console.log("\n📊 Current DB state:");
  console.log("─".repeat(48));
  for (const { name, count } of counts) {
    const marker = count === 0 ? "·" : "●";
    console.log(
      `  ${marker} ${name.padEnd(24)} ${count.toString().padStart(6)} rows`,
    );
  }
  console.log("─".repeat(48));
  console.log(
    `  ✓ deadline_rules           ${(rulesCount[0]?.c ?? 0)
      .toString()
      .padStart(6)} rows  (preserved)`,
  );
  console.log("─".repeat(48));
  console.log(`  Total tenant rows to delete: ${totalTenantRows}`);

  if (DRY_RUN) {
    console.log(
      "\n🔍 Dry run — nothing deleted. Re-run with --yes to actually clear:",
    );
    console.log("   pnpm db:clean --yes");
    return;
  }

  if (totalTenantRows === 0) {
    console.log("\n✨ Already empty. Nothing to do.");
    return;
  }

  // ---- Delete ----
  console.log("\n🔥 Deleting…");
  for (const { name, table } of TABLES) {
    await db.delete(table);
    process.stdout.write(`   ✓ cleared ${name}\n`);
  }

  console.log(
    "\n✅ Done. Reload the app — your user + org will rebuild on next page load.",
  );
}

main().catch((err) => {
  console.error("\n❌ Failed:", err);
  process.exit(1);
});
