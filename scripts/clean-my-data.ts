/**
 * Wipe yxiao@dify.ai's workspace ("Yi Xiao's practice") to a clean
 * slate for re-importing data, while keeping the user + org rows so
 * the next browser load doesn't need a fresh bootstrap.
 *
 * Also removes yxiaoisme@gmail.com from the org and (if they have no
 * other memberships) deletes their user row entirely.
 *
 *   pnpm dotenv -e .env.local -- tsx scripts/clean-my-data.ts        (dry run)
 *   pnpm dotenv -e .env.local -- tsx scripts/clean-my-data.ts --yes  (execute)
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const ORG_ID = "org_i-tzNpUfsPjp";
const REMOVE_EMAIL = "yxiaoisme@gmail.com";
const DRY_RUN = !process.argv.includes("--yes");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}
const sql = neon(url);

// FK-safe order: children before parents. CASCADE would handle most of
// this, but explicit order makes the log readable + lets us verify
// counts step-by-step.
const ORG_SCOPED_TABLES = [
  "notifications",
  "deadline_subtasks",
  "reminders_sent",
  "deadline_instances",
  "audit_events",
  "entities",
  "clients",
  "invitations",
  "digest_sends",
  "announcements",
] as const;

async function tableExistsWithOrg(name: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${name}
      AND column_name = 'org_id'
  `;
  return rows.length > 0;
}

async function countInOrg(table: string): Promise<number> {
  const r = (await sql.query(
    `SELECT COUNT(*)::int AS c FROM "${table}" WHERE org_id = $1`,
    [ORG_ID],
  )) as unknown as { rows?: Array<{ c: number }> } & Array<{ c: number }>;
  const rows = r.rows ?? r;
  return rows[0]?.c ?? 0;
}

async function deleteInOrg(table: string): Promise<number> {
  const r = (await sql.query(
    `DELETE FROM "${table}" WHERE org_id = $1`,
    [ORG_ID],
  )) as unknown as { rowCount?: number };
  return r.rowCount ?? 0;
}

async function main() {
  console.log(`Target org: ${ORG_ID}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (re-run with --yes to execute)" : "EXECUTE"}\n`);

  console.log("== Before ==");
  for (const t of ORG_SCOPED_TABLES) {
    if (!(await tableExistsWithOrg(t))) {
      console.log(`  · ${t.padEnd(22)} (skip — not org-scoped)`);
      continue;
    }
    const c = await countInOrg(t);
    console.log(`  ${c > 0 ? "●" : "·"} ${t.padEnd(22)} ${String(c).padStart(6)}`);
  }

  // Find user-to-remove + their other memberships
  const u = await sql`SELECT id FROM users WHERE email = ${REMOVE_EMAIL}`;
  const removeUserId: string | null = u[0]?.id ?? null;
  let otherMembershipCount = 0;
  if (removeUserId) {
    const m = await sql`SELECT COUNT(*)::int AS c FROM memberships WHERE user_id = ${removeUserId} AND org_id != ${ORG_ID}`;
    otherMembershipCount = m[0].c;
    console.log(`\nSecond member ${REMOVE_EMAIL}: id=${removeUserId}, other orgs=${otherMembershipCount}`);
  } else {
    console.log(`\nSecond member ${REMOVE_EMAIL}: not found (already gone)`);
  }

  if (DRY_RUN) {
    console.log("\nDry run complete. Re-run with --yes to actually delete.");
    return;
  }

  // ---- Execute ----
  console.log("\n== Deleting ==");
  for (const t of ORG_SCOPED_TABLES) {
    if (!(await tableExistsWithOrg(t))) continue;
    const n = await deleteInOrg(t);
    console.log(`  ✓ ${t.padEnd(22)} -${n}`);
  }

  if (removeUserId) {
    await sql`DELETE FROM memberships WHERE org_id = ${ORG_ID} AND user_id = ${removeUserId}`;
    console.log(`  ✓ membership for ${REMOVE_EMAIL} in ${ORG_ID}`);
    if (otherMembershipCount === 0) {
      await sql`DELETE FROM users WHERE id = ${removeUserId}`;
      console.log(`  ✓ user row ${REMOVE_EMAIL} (no other orgs)`);
    } else {
      console.log(`  · keeping user row (still in ${otherMembershipCount} other org(s))`);
    }
  }

  console.log("\n== After ==");
  for (const t of ORG_SCOPED_TABLES) {
    if (!(await tableExistsWithOrg(t))) continue;
    const c = await countInOrg(t);
    console.log(`  ${c > 0 ? "●" : "·"} ${t.padEnd(22)} ${String(c).padStart(6)}`);
  }

  // Sanity: org + owner membership preserved
  const orgRow = await sql`SELECT id, name FROM organizations WHERE id = ${ORG_ID}`;
  const ownerRow = await sql`SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${ORG_ID}`;
  console.log("\nPreserved:");
  console.log(`  org: ${orgRow[0]?.name ?? "(MISSING!)"} (${orgRow[0]?.id ?? "—"})`);
  console.log(`  remaining members: ${ownerRow.map((r) => `${r.email} (${r.role})`).join(", ") || "(none)"}`);
  console.log("\nDone. Refresh localhost:3000 to see the empty workspace.");
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
