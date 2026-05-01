/**
 * Surgical removal of the import-wizard QA seed clients.
 *
 * The mock-clients CSV (scripts/generate-mock-clients.ts) deliberately
 * includes 2 edge-case rows that exercise the import wizard's warning
 * paths:
 *   - "Ambiguous Client" — Type=Weird Thing → should default to Individual
 *   - "Victor Kovalenko" — Email=not-a-valid-email → should be cleared
 *
 * Once you've imported the mock CSV at least once for development, those
 * two rows live in your DB forever and clutter demos. This script wipes
 * them surgically (with their entities + deadline_instances) without
 * touching any other data.
 *
 *   pnpm tsx scripts/remove-test-clients.ts          → dry run
 *   pnpm tsx scripts/remove-test-clients.ts --yes    → actually delete
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray, or } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL not set. Run `vercel env pull .env.local` first.",
  );
  process.exit(1);
}

const DRY_RUN = !process.argv.includes("--yes");
const db = drizzle(neon(process.env.DATABASE_URL), { schema });

const TARGET_NAMES = ["Ambiguous Client", "Victor Kovalenko"];

async function main() {
  const matches = await db
    .select({
      id: schema.clients.id,
      name: schema.clients.name,
      orgId: schema.clients.orgId,
    })
    .from(schema.clients)
    .where(
      or(...TARGET_NAMES.map((n) => eq(schema.clients.name, n))),
    );

  if (matches.length === 0) {
    console.log("Nothing to remove — neither test client exists in the DB.");
    return;
  }

  console.log(`Found ${matches.length} test client(s):`);
  for (const m of matches) {
    console.log(`  - ${m.name}  (id=${m.id}, org=${m.orgId})`);
  }

  // Cascading children (entities + deadline_instances) so we can show
  // the full blast radius before pulling the trigger.
  const ids = matches.map((m) => m.id);
  const ents = await db
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .where(inArray(schema.entities.clientId, ids));
  const entIds = ents.map((e) => e.id);
  const deadlines = entIds.length
    ? await db
        .select({ id: schema.deadlineInstances.id })
        .from(schema.deadlineInstances)
        .where(inArray(schema.deadlineInstances.entityId, entIds))
    : [];

  console.log(
    `Cascade: ${ents.length} entities, ${deadlines.length} deadline instances will also be removed.`,
  );

  if (DRY_RUN) {
    console.log(
      "\nDry run — nothing deleted. Re-run with --yes to actually delete:",
    );
    console.log("  pnpm tsx scripts/remove-test-clients.ts --yes");
    return;
  }

  // Delete leaves first, then up the FK chain.
  if (deadlines.length) {
    await db
      .delete(schema.deadlineInstances)
      .where(
        inArray(
          schema.deadlineInstances.id,
          deadlines.map((d) => d.id),
        ),
      );
  }
  if (entIds.length) {
    await db
      .delete(schema.entities)
      .where(inArray(schema.entities.id, entIds));
  }
  await db.delete(schema.clients).where(inArray(schema.clients.id, ids));

  console.log(
    `\nDone. Removed ${matches.length} client(s), ${ents.length} entity/entities, ${deadlines.length} deadline(s).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
