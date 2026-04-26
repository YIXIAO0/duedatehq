/**
 * One-off: copy every client's existing primary_contact_email and
 * primary_contact_phone into a priority=0 client_contacts row.
 *
 * Idempotent — skips clients that already have a priority=0 row.
 *
 *   pnpm tsx scripts/backfill-client-contacts.ts             → dry run
 *   pnpm tsx scripts/backfill-client-contacts.ts --yes       → write
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { clientContacts } from "../src/lib/db/schema";

config({ path: ".env.local" });
const DRY_RUN = !process.argv.includes("--yes");
const db = drizzle(neon(process.env.DATABASE_URL!), {
  schema: { clientContacts },
});

async function main() {
  // Find every client that has at least one of email/phone set AND
  // doesn't already have a priority=0 contact row.
  const candidates = await db.execute<{
    id: string;
    org_id: string;
    name: string;
    primary_contact_email: string | null;
    primary_contact_phone: string | null;
  }>(sql`
    SELECT c.id, c.org_id, c.name,
           c.primary_contact_email, c.primary_contact_phone
    FROM clients c
    WHERE (c.primary_contact_email IS NOT NULL OR c.primary_contact_phone IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM client_contacts cc
        WHERE cc.client_id = c.id
          AND cc.priority = 0
          AND cc.archived_at IS NULL
      )
  `);

  console.log(`Found ${candidates.rows.length} clients to backfill.\n`);
  if (candidates.rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const c of candidates.rows) {
    console.log(
      `  ${c.name}: email=${c.primary_contact_email ?? "—"}  phone=${c.primary_contact_phone ?? "—"}`,
    );
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — re-run with --yes to write.");
    return;
  }

  let inserted = 0;
  for (const c of candidates.rows) {
    await db.insert(clientContacts).values({
      clientId: c.id,
      orgId: c.org_id,
      // Best-effort: if name has a "(role)" pattern we'd parse it, but
      // for now just leave the contact unnamed and let the user edit.
      name: null,
      email: c.primary_contact_email,
      phone: c.primary_contact_phone,
      role: null,
      priority: 0,
      receivesReminders: true,
    });
    inserted++;
  }
  console.log(`\n✓ Inserted ${inserted} priority=0 contact rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
