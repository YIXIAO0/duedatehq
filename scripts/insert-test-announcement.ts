import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { announcements } from "../src/lib/db/schema";

config({ path: ".env.local" });
const db = drizzle(neon(process.env.DATABASE_URL!), {
  schema: { announcements },
});

async function main() {
  // Use Drizzle's insert builder so the id $defaultFn fires.
  await db
    .insert(announcements)
    .values({
      source: "irs_newsroom",
      externalId: "IR-TEST-FL-MATCH",
      title:
        "TEST: IRS extends Apr 15 deadline for hurricane victims in FL and TX",
      summary: "Test row to validate the announcement-client matching feature.",
      url: "https://www.irs.gov/test",
      publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      category: "disaster_relief",
      affectedJurisdictions: ["FL", "TX"],
      relevanceScore: 5,
      aiSummary:
        "IRS postpones April 15 federal income tax deadline to October 15 for taxpayers in declared FL and TX disaster areas.",
    })
    .onConflictDoNothing();
  console.log("Inserted (or skipped) test row.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
