/**
 * Smoke-test: replicate the getAnnouncementReview SQL inline so we can
 * verify the jsonb cast works before deploying. Skip importing the
 * server-only service.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });
const db = drizzle(neon(process.env.DATABASE_URL!));

async function main() {
  const ann = await db.execute<{
    id: string;
    title: string;
    affected_jurisdictions: string[];
  }>(sql`
    SELECT id, title, affected_jurisdictions
    FROM announcements
    WHERE external_id = 'IR-TEST-FL-MATCH'
    LIMIT 1
  `);
  const a = ann.rows[0];
  if (!a) {
    console.log("No test row.");
    return;
  }
  console.log(`Announcement: ${a.title.slice(0, 60)}...`);
  console.log(`affected_jurisdictions: ${JSON.stringify(a.affected_jurisdictions)}`);

  const org = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations LIMIT 1`,
  );
  const orgId = org.rows[0].id;
  const user = await db.execute<{ id: string }>(
    sql`SELECT id FROM users LIMIT 1`,
  );
  const userId = user.rows[0].id;

  const affectedJsonb = JSON.stringify(a.affected_jurisdictions ?? []);

  const rows = await db.execute<{
    client_id: string;
    client_name: string;
    matched_states: string[];
    open_deadlines: unknown[] | null;
    acked: boolean;
  }>(sql`
    SELECT
      c.id AS client_id,
      c.name AS client_name,
      ARRAY(
        SELECT DISTINCT e.home_state
        FROM entities e
        WHERE e.client_id = c.id
          AND e.archived_at IS NULL
          AND e.home_state IS NOT NULL
          AND (${affectedJsonb}::jsonb) ? e.home_state
      ) AS matched_states,
      (
        SELECT COALESCE(jsonb_agg(d ORDER BY d.effective_due_date ASC), '[]'::jsonb)
        FROM (
          SELECT
            di.id,
            di.due_date::text AS due_date,
            COALESCE(di.extension_due_date, di.due_date)::text AS effective_due_date,
            di.status::text AS status,
            r.form_code,
            r.title AS rule_title,
            r.jurisdiction_code
          FROM deadline_instances di
          INNER JOIN entities e2 ON e2.id = di.entity_id
          INNER JOIN deadline_rules r ON r.id = di.rule_id
          WHERE e2.client_id = c.id
            AND e2.archived_at IS NULL
            AND di.status IN ('pending', 'in_progress', 'extended')
            AND (
              (${affectedJsonb}::jsonb) ? r.jurisdiction_code
              OR r.jurisdiction_code = 'federal'
            )
        ) d
      ) AS open_deadlines,
      EXISTS (
        SELECT 1 FROM announcement_client_acks ack
        WHERE ack.announcement_id = ${a.id}
          AND ack.client_id = c.id
          AND ack.user_id = ${userId}
      ) AS acked
    FROM clients c
    WHERE c.org_id = ${orgId}
      AND c.archived_at IS NULL
      AND EXISTS (
        SELECT 1 FROM entities e
        WHERE e.client_id = c.id
          AND e.archived_at IS NULL
          AND e.home_state IS NOT NULL
          AND (${affectedJsonb}::jsonb) ? e.home_state
      )
    ORDER BY acked ASC, c.name ASC
  `);

  console.log(`\nMatched ${rows.rows.length} clients:`);
  for (const r of rows.rows) {
    const dl = (r.open_deadlines ?? []).length;
    console.log(
      `  ${r.acked ? "✓" : "○"} ${r.client_name} [${r.matched_states.join(",")}] · ${dl} open deadlines`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
