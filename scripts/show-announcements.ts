/**
 * One-off: dump current announcements with their AI scoring, so I can
 * eyeball whether the classifier is calibrated right.
 *
 *   pnpm tsx scripts/show-announcements.ts
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

const db = drizzle(neon(process.env.DATABASE_URL));

async function main() {
  const rows = await db.execute<{
    external_id: string;
    title: string;
    category: string;
    relevance_score: number;
    affected_jurisdictions: string[];
    ai_summary: string | null;
  }>(sql`
    SELECT external_id, title, category, relevance_score,
           affected_jurisdictions, ai_summary
    FROM announcements
    ORDER BY relevance_score DESC, published_at DESC
  `);

  console.log(`\nTotal: ${rows.rows.length}\n`);
  for (const r of rows.rows) {
    const jur = (r.affected_jurisdictions ?? []).join(",") || "-";
    const scoreBar = "●".repeat(r.relevance_score) + "○".repeat(5 - r.relevance_score);
    console.log(`${scoreBar} [${r.category.padEnd(16)}] ${r.external_id} | ${jur}`);
    console.log(`        ${r.title}`);
    if (r.ai_summary) console.log(`        → ${r.ai_summary}`);
    console.log();
  }

  // Score histogram
  const hist = [0, 0, 0, 0, 0, 0];
  for (const r of rows.rows) hist[r.relevance_score]++;
  console.log("Score histogram:");
  for (let i = 5; i >= 1; i--) {
    console.log(`  ${i}: ${"■".repeat(hist[i])} (${hist[i]})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
