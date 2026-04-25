/**
 * Cleanup: remove the synthetic FL+TX row from
 * scripts/insert-test-announcement.ts after we've validated the
 * client-impact UI in production.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });
const db = drizzle(neon(process.env.DATABASE_URL!));

async function main() {
  const r = await db.execute(sql`
    DELETE FROM announcements
    WHERE source = 'irs_newsroom' AND external_id = 'IR-TEST-FL-MATCH'
  `);
  console.log(`Removed test row (rowCount=${r.rowCount ?? 0}).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
