import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });
const db = drizzle(neon(process.env.DATABASE_URL!));

async function main() {
  const total = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM deadline_rules`,
  );
  console.log(`Total rules: ${total.rows[0]?.n ?? 0}`);

  const perJur = await db.execute<{
    jurisdiction_code: string;
    n: number;
  }>(sql`
    SELECT jurisdiction_code, COUNT(*)::int AS n
    FROM deadline_rules
    GROUP BY jurisdiction_code
    ORDER BY n DESC
  `);
  console.log("\nPer jurisdiction:");
  for (const r of perJur.rows) console.log(`  ${r.jurisdiction_code}: ${r.n}`);

  const dupes = await db.execute<{
    jurisdiction_code: string;
    form_code: string;
    title: string;
    n: number;
  }>(sql`
    SELECT jurisdiction_code, form_code, title, COUNT(*)::int AS n
    FROM deadline_rules
    GROUP BY jurisdiction_code, form_code, title, version
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 20
  `);
  console.log(`\nDuplicate natural keys: ${dupes.rows.length}`);
  for (const r of dupes.rows) {
    console.log(`  ${r.jurisdiction_code} / ${r.form_code}: ${r.n} copies`);
  }
}

main().catch(console.error);
