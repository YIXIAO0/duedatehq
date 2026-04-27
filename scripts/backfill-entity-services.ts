/**
 * Backfill: assign default services to existing entities that have no
 * active service assignments yet.
 *
 * Run once after deploying the service-groups feature:
 *   pnpm exec dotenv -e .env.local -- tsx scripts/backfill-entity-services.ts
 *
 * Idempotent — only touches entities with zero active services. Re-runs
 * are safe.
 *
 * Inlines the SQL directly so we don't have to drag the `server-only`
 * import chain (the entity-services service uses `server-only` which
 * crashes outside Next.js runtime).
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, isNull } from "drizzle-orm";
import {
  entities,
  entityServices,
  organizations,
  serviceGroups,
} from "../src/lib/db/schema";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
}

const neonClient = neon(process.env.DATABASE_URL);
const db = drizzle(neonClient);

async function main() {
  const orgs = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations);

  console.log(`Backfilling default services across ${orgs.length} orgs…`);

  // Pre-load every built-in service so we can map entityType → service IDs
  // without N queries during the loop.
  const allServices = await db
    .select()
    .from(serviceGroups)
    .where(and(isNull(serviceGroups.orgId), isNull(serviceGroups.archivedAt)));

  const defaultsByEntityType = new Map<string, string[]>();
  for (const svc of allServices) {
    for (const t of svc.defaultForEntityTypes ?? []) {
      const existing = defaultsByEntityType.get(t) ?? [];
      existing.push(svc.id);
      defaultsByEntityType.set(t, existing);
    }
  }

  let totalEntities = 0;
  let totalAssignments = 0;

  for (const org of orgs) {
    const orgEntities = await db
      .select()
      .from(entities)
      .where(and(eq(entities.orgId, org.id), isNull(entities.archivedAt)));

    let backfilledForOrg = 0;
    let assignmentsForOrg = 0;

    for (const e of orgEntities) {
      // Skip if already has services. Cheap check: one row at most via
      // the partial unique index.
      const existing = await db
        .select({ id: entityServices.id })
        .from(entityServices)
        .where(
          and(
            eq(entityServices.entityId, e.id),
            isNull(entityServices.removedAt),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const defaults = defaultsByEntityType.get(e.entityType) ?? [];
      if (defaults.length === 0) continue;

      await db.insert(entityServices).values(
        defaults.map((serviceGroupId) => ({
          entityId: e.id,
          serviceGroupId,
          orgId: org.id,
        })),
      );

      backfilledForOrg++;
      assignmentsForOrg += defaults.length;
    }

    if (backfilledForOrg > 0) {
      console.log(
        `  ${org.name}: ${backfilledForOrg} entities → ${assignmentsForOrg} assignments`,
      );
    }
    totalEntities += backfilledForOrg;
    totalAssignments += assignmentsForOrg;
  }

  console.log(
    `✅ Backfilled ${totalEntities} entities with ${totalAssignments} service assignments.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
