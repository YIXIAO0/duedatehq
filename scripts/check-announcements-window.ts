import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });
const db = drizzle(neon(process.env.DATABASE_URL!));

async function main() {
  const r = await db.execute<{
    external_id: string;
    title: string;
    relevance_score: number;
    published_at: Date;
    age: string;
  }>(sql`
    SELECT external_id, title, relevance_score,
           published_at::text AS published_at,
           AGE(NOW(), published_at)::text AS age
    FROM announcements
    WHERE relevance_score >= 4
    ORDER BY published_at DESC
  `);
  console.log("All score >= 4 items:\n");
  for (const row of r.rows) {
    console.log(
      `  ${row.external_id}  score=${row.relevance_score}  published=${row.published_at}  age=${row.age}`,
    );
  }

  const within7 = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM announcements
    WHERE relevance_score >= 4
      AND published_at >= NOW() - INTERVAL '7 days'
  `);
  console.log(
    `\nscore >= 4 in last 7d: ${within7.rows[0]?.n ?? 0}`,
  );

  const within30 = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM announcements
    WHERE relevance_score >= 4
      AND published_at >= NOW() - INTERVAL '30 days'
  `);
  console.log(`score >= 4 in last 30d: ${within30.rows[0]?.n ?? 0}`);

  const now = await db.execute<{ now: string }>(
    sql`SELECT NOW()::text AS now`,
  );
  console.log(`\n(DB clock: ${now.rows[0]?.now})`);
}

main().catch(console.error);
