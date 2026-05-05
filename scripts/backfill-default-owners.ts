/**
 * One-time backfill: for every org with EXACTLY ONE member, assign
 * that member as `owner_user_id` on every open deadline that's
 * currently unassigned.
 *
 * Why: the daily reminder cron filters with `owner_user_id IS NOT NULL`,
 * so solo CPAs never received reminders before this fix landed.
 * deadline-engine.ts now defaults the owner at create time for new
 * deadlines; this script catches up everything created earlier.
 *
 * Safety:
 *   - Only acts on orgs with exactly 1 member. Multi-member orgs are
 *     skipped — assigning the "first" member would be arbitrary, and
 *     the existing UX (explicit assignment) is correct for them.
 *   - Only updates `completed_at IS NULL` rows. Already-filed deadlines
 *     are out of reminder scope anyway.
 *   - Idempotent: re-running it does nothing once owners are set.
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });
const db = drizzle(neon(process.env.DATABASE_URL!));

async function main() {
  const result = await db.execute<{
    org_id: string;
    user_id: string;
    updated: number;
  }>(sql`
    WITH solo_orgs AS (
      SELECT org_id, MIN(user_id) AS user_id
      FROM memberships
      GROUP BY org_id
      HAVING COUNT(*) = 1
    ),
    upd AS (
      UPDATE deadline_instances di
      SET owner_user_id = s.user_id, updated_at = NOW()
      FROM solo_orgs s
      WHERE di.org_id = s.org_id
        AND di.owner_user_id IS NULL
        AND di.completed_at IS NULL
      RETURNING di.org_id, s.user_id
    )
    SELECT org_id, user_id, COUNT(*)::int AS updated
    FROM upd
    GROUP BY org_id, user_id
    ORDER BY updated DESC
  `);

  if (result.rows.length === 0) {
    console.log("No solo-org deadlines needed backfill (nothing to do).");
    return;
  }

  console.log("Backfill complete:");
  for (const r of result.rows) {
    console.log(
      `  org=${r.org_id} user=${r.user_id} updated=${r.updated} rows`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
