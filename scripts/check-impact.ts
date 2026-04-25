import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });
const db = drizzle(neon(process.env.DATABASE_URL!));

async function main() {
  // Pick the user's org id (first row).
  const orgs = await db.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM organizations LIMIT 1`,
  );
  const orgId = orgs.rows[0]?.id;
  if (!orgId) {
    console.log("No org yet — skipping match preview.");
    return;
  }
  console.log(`Org: ${orgs.rows[0].name} (${orgId})\n`);

  // Show entities home_state distribution
  const states = await db.execute<{ home_state: string; n: number }>(sql`
    SELECT home_state, COUNT(*)::int AS n
    FROM entities
    WHERE org_id = ${orgId} AND archived_at IS NULL
    GROUP BY home_state
    ORDER BY n DESC
  `);
  console.log("Entity home_state distribution:");
  for (const r of states.rows) console.log(`  ${r.home_state ?? "(null)"}: ${r.n}`);

  // Run the same SQL the new service runs
  const rows = await db.execute<{
    title: string;
    relevance_score: number;
    affected_jurisdictions: string[];
    affected_clients: Array<{ id: string; name: string }> | null;
  }>(sql`
    SELECT
      a.title, a.relevance_score, a.affected_jurisdictions,
      COALESCE(
        (
          SELECT jsonb_agg(
            DISTINCT jsonb_build_object('id', c.id, 'name', c.name)
          )
          FROM clients c
          INNER JOIN entities e ON e.client_id = c.id
          WHERE c.org_id = ${orgId}
            AND c.archived_at IS NULL
            AND e.archived_at IS NULL
            AND e.home_state IS NOT NULL
            AND a.affected_jurisdictions ? e.home_state
        ),
        '[]'::jsonb
      ) AS affected_clients
    FROM announcements a
    WHERE a.relevance_score >= 3
    ORDER BY a.relevance_score DESC, a.published_at DESC
    LIMIT 10
  `);

  console.log(`\nMatched announcements (score>=3, top 10):\n`);
  for (const r of rows.rows) {
    const clientList = r.affected_clients ?? [];
    const jur = (r.affected_jurisdictions ?? []).join(",");
    console.log(
      `  score=${r.relevance_score}  juris=[${jur}]  affects=${clientList.length}  ${r.title.slice(0, 80)}`,
    );
    for (const c of clientList) console.log(`      → ${c.name}`);
  }
}

main().catch(console.error);
