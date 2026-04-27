/**
 * Service-group assignment for entities.
 *
 * The CPA picks "Personal Tax Filing + Quarterly Payroll" when adding
 * a client; we record those choices in `entity_services` and the
 * deadline engine narrows which rules to materialize accordingly.
 *
 * Two layers of indirection here on purpose:
 *   - service_groups owns "what does this bundle mean?" (slug, name,
 *     default-for-entity-types)
 *   - entity_services owns "which bundles are active for this entity?"
 *     with soft-delete via removed_at so we can show history later.
 */

import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  entities,
  entityServices,
  serviceGroups,
  type ServiceGroup,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List all built-in service groups available to a firm. Sorted by
 * `sortOrder` so the most common ones (Personal / C-Corp / S-Corp /
 * Partnership) appear first in pickers.
 */
export async function listAvailableServices(): Promise<ServiceGroup[]> {
  const db = getDb();
  return db
    .select()
    .from(serviceGroups)
    .where(
      and(
        // Built-in services have NULL org_id. Future: union with the
        // calling org's customized services.
        isNull(serviceGroups.orgId),
        isNull(serviceGroups.archivedAt),
      ),
    )
    .orderBy(asc(serviceGroups.sortOrder), asc(serviceGroups.slug));
}

/**
 * Active service IDs for a single entity. Returns an array of IDs so
 * callers can quickly check membership / mark checkboxes in UIs.
 */
export async function listActiveServiceIdsForEntity(
  entityId: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: entityServices.serviceGroupId })
    .from(entityServices)
    .where(
      and(
        eq(entityServices.entityId, entityId),
        isNull(entityServices.removedAt),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Active services for a single entity, joined with the service-group
 * record so callers (entity card, badges) can render names and slugs
 * without a second query.
 */
export async function listActiveServicesForEntity(
  entityId: string,
): Promise<ServiceGroup[]> {
  const db = getDb();
  const rows = await db
    .select({
      sg: serviceGroups,
    })
    .from(entityServices)
    .innerJoin(
      serviceGroups,
      eq(serviceGroups.id, entityServices.serviceGroupId),
    )
    .where(
      and(
        eq(entityServices.entityId, entityId),
        isNull(entityServices.removedAt),
      ),
    )
    .orderBy(asc(serviceGroups.sortOrder));
  return rows.map((r) => r.sg);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Replace the full set of active services on an entity. Idempotent:
 *   - Services in `desiredServiceIds` that aren't already active get
 *     inserted.
 *   - Active services NOT in the new list get soft-deleted (removed_at
 *     is set).
 *
 * Doesn't regenerate deadlines on its own — caller is responsible for
 * triggering re-materialization (typically via generateDeadlinesForEntity).
 * That separation keeps "what services are on this entity" decoupled
 * from "which deadlines exist", so future flows (preview, dry-run)
 * can compose these primitives.
 */
export async function setEntityServices(args: {
  entityId: string;
  orgId: string;
  desiredServiceIds: string[];
  actorType?: "user" | "agent" | "cron" | "system";
  actorId: string | null;
}): Promise<{ added: string[]; removed: string[] }> {
  const db = getDb();

  const currentRows = await db
    .select({ id: entityServices.serviceGroupId })
    .from(entityServices)
    .where(
      and(
        eq(entityServices.entityId, args.entityId),
        isNull(entityServices.removedAt),
      ),
    );
  const current = new Set(currentRows.map((r) => r.id));
  const desired = new Set(args.desiredServiceIds);

  const toAdd = [...desired].filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !desired.has(id));

  // Soft-delete removed services. We use removed_at instead of an
  // actual DELETE so re-enabling the same service later preserves
  // the history trail (when did the firm first add this service?).
  if (toRemove.length > 0) {
    await db
      .update(entityServices)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(entityServices.entityId, args.entityId),
          inArray(entityServices.serviceGroupId, toRemove),
          isNull(entityServices.removedAt),
        ),
      );
  }

  // Insert newly-added services. The unique partial index on
  // (entity_id, service_group_id) WHERE removed_at IS NULL prevents
  // duplicate active rows even under concurrent writes.
  if (toAdd.length > 0) {
    await db.insert(entityServices).values(
      toAdd.map((serviceGroupId) => ({
        entityId: args.entityId,
        serviceGroupId,
        orgId: args.orgId,
      })),
    );
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    await recordAudit({
      orgId: args.orgId,
      actorType: args.actorType ?? "user",
      actorId: args.actorId,
      action: "entity.services_updated",
      targetType: "entity",
      targetId: args.entityId,
      payload: { added: toAdd, removed: toRemove },
    });
  }

  return { added: toAdd, removed: toRemove };
}

// ---------------------------------------------------------------------------
// Defaults — picks the services that should be pre-checked when adding
// an entity of a given type. Used by the form to suggest "Personal
// Tax" for individuals, "C-Corp Tax" for c_corps, etc.
//
// Driven by `defaultForEntityTypes` on each service group, which the
// seed maintains. Returns the IDs of matching built-in services in
// sortOrder order.
// ---------------------------------------------------------------------------

export async function defaultServiceIdsForEntityType(
  entityType: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: serviceGroups.id,
      sortOrder: serviceGroups.sortOrder,
    })
    .from(serviceGroups)
    .where(
      and(
        isNull(serviceGroups.orgId),
        isNull(serviceGroups.archivedAt),
      ),
    )
    .orderBy(asc(serviceGroups.sortOrder));

  // Filter in JS — defaultForEntityTypes is a small jsonb array, and
  // the candidate set is ~11 rows total. Cheaper to pull all and
  // filter than write a jsonb-containment query.
  const all = await db.select().from(serviceGroups).where(isNull(serviceGroups.orgId));
  const matchingIds = new Set(
    all
      .filter((s) => (s.defaultForEntityTypes ?? []).includes(entityType))
      .map((s) => s.id),
  );
  return rows.filter((r) => matchingIds.has(r.id)).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Backfill — assigns default services to existing entities that have
// no active services row. Idempotent and safe to re-run; only touches
// entities with zero active services.
//
// Used as a one-shot migration when shipping the service-groups
// feature to existing accounts.
// ---------------------------------------------------------------------------

export async function backfillDefaultServicesForExistingEntities(args: {
  orgId: string;
}): Promise<{ entitiesBackfilled: number; serviceAssignments: number }> {
  const db = getDb();

  const allEntities = await db
    .select()
    .from(entities)
    .where(
      and(eq(entities.orgId, args.orgId), isNull(entities.archivedAt)),
    );

  let entitiesBackfilled = 0;
  let serviceAssignments = 0;

  for (const e of allEntities) {
    const existing = await listActiveServiceIdsForEntity(e.id);
    if (existing.length > 0) continue; // already has services, skip

    const defaults = await defaultServiceIdsForEntityType(e.entityType);
    if (defaults.length === 0) continue;

    await db.insert(entityServices).values(
      defaults.map((serviceGroupId) => ({
        entityId: e.id,
        serviceGroupId,
        orgId: args.orgId,
      })),
    );

    entitiesBackfilled++;
    serviceAssignments += defaults.length;
  }

  return { entitiesBackfilled, serviceAssignments };
}
