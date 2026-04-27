/**
 * Entity service — a client can have multiple tax entities (individual,
 * S-Corp, LLC, trust, etc.). Each entity is the unit that generates deadlines.
 *
 * On create, we immediately materialize the entity's deadlines for the current
 * and upcoming tax year via the deadline engine. CPAs should see a full-year
 * calendar within seconds of adding an entity.
 */

import "server-only";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { entities, type Entity } from "@/lib/db/schema";
import { generateDeadlinesForEntity } from "./deadline-engine";
import { recordAudit } from "./audit";
import {
  defaultServiceIdsForEntityType,
  setEntityServices,
} from "./entity-services";

const US_STATE = z
  .string()
  .length(2)
  .regex(/^[A-Z]{2}$/, "State must be 2-letter uppercase code");

const ENTITY_TYPES = [
  "individual",
  "c_corp",
  "s_corp",
  "partnership",
  "llc",
  "trust",
  "estate",
  "nonprofit",
] as const;

export const CreateEntityInputSchema = z.object({
  orgId: z.string(),
  clientId: z.string(),
  name: z.string().min(1).max(200),
  entityType: z.enum(ENTITY_TYPES),
  homeState: US_STATE.optional(),
  operatingStates: z.array(US_STATE).default([]),
  ein: z.string().max(20).optional(),
  fiscalYearEnd: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .default("12-31"),
  /**
   * Service group IDs to assign to the new entity. When omitted, the
   * caller hasn't expressed a preference — the service layer falls
   * back to the entity-type defaults (Personal Tax for individuals,
   * etc.). Pass an empty array to mean "no services" explicitly.
   */
  serviceGroupIds: z.array(z.string()).optional(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
  /** Import opt-in: materialize past-tax-year deadlines as status="completed". */
  includeHistoricalAsCompleted: z.boolean().default(false),
});
export type CreateEntityInput = z.input<typeof CreateEntityInputSchema>;

export const ListEntitiesInputSchema = z.object({
  orgId: z.string(),
  clientId: z.string().optional(),
});
export type ListEntitiesInput = z.input<typeof ListEntitiesInputSchema>;

/**
 * Create an entity AND materialize its deadlines for the current tax year.
 * Returns both the entity and the deadline-generation stats so the UI can
 * render a "generated 16 deadlines for 2025" confirmation.
 */
export async function createEntity(input: CreateEntityInput) {
  const parsed = CreateEntityInputSchema.parse(input);
  const db = getDb();

  // Dedupe operating states; include home state implicitly
  const operatingStates = Array.from(
    new Set(
      [
        parsed.homeState,
        ...parsed.operatingStates,
      ].filter((s): s is string => Boolean(s)),
    ),
  );

  const [row] = await db
    .insert(entities)
    .values({
      orgId: parsed.orgId,
      clientId: parsed.clientId,
      name: parsed.name,
      entityType: parsed.entityType,
      homeState: parsed.homeState,
      operatingStates,
      ein: parsed.ein,
      fiscalYearEnd: parsed.fiscalYearEnd,
    })
    .returning();

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "entity.created",
    targetType: "entity",
    targetId: row.id,
    payload: { name: parsed.name, entityType: parsed.entityType },
  });

  // Service-group assignment. Caller-supplied list wins; otherwise we
  // pick the defaults that match the entity type (Personal Tax for
  // individuals, C-Corp Tax for c_corps, etc.). The deadline engine
  // then materializes only the rules attached to those services.
  const serviceIds = parsed.serviceGroupIds
    ? parsed.serviceGroupIds
    : await defaultServiceIdsForEntityType(parsed.entityType);
  if (serviceIds.length > 0) {
    await setEntityServices({
      entityId: row.id,
      orgId: parsed.orgId,
      desiredServiceIds: serviceIds,
      actorType: parsed.actorType,
      actorId: parsed.actorId,
    });
  }

  // Fire-and-await: generate deadlines for the current tax year.
  // We use `taxYear = currentYear - 1` if we're before April, reflecting
  // that CPAs are filing *last year's* returns in Jan–Apr; otherwise the
  // next tax year. Either way, create both to be safe.
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const taxYears = [currentYear - 1, currentYear];

  let created = 0;
  for (const taxYear of taxYears) {
    const stats = await generateDeadlinesForEntity(
      {
        orgId: parsed.orgId,
        entityId: row.id,
        taxYear,
        actorType: parsed.actorType,
        actorId: parsed.actorId,
        includeHistoricalAsCompleted: parsed.includeHistoricalAsCompleted,
      },
      row,
    );
    created += stats.created;
  }

  return { entity: row, deadlinesCreated: created };
}

// ---------------------------------------------------------------------------
// Update / Archive
// ---------------------------------------------------------------------------

export const UpdateEntityInputSchema = z.object({
  id: z.string().min(1),
  orgId: z.string(),
  name: z.string().min(1).max(200),
  entityType: z.enum(ENTITY_TYPES),
  homeState: US_STATE.optional().or(z.literal("")),
  operatingStates: z.array(US_STATE).default([]),
  ein: z.string().max(20).optional(),
  // MM-DD format. Optional on edit — when omitted, the existing value
  // is preserved (we don't blast it back to "12-31"). Used to switch
  // an entity to a fiscal year mid-life when the CPA realizes their
  // C-corp client elected a Jun 30 FYE.
  fiscalYearEnd: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .optional(),
  /** When supplied, replace the entity's active services. Omitted =
   *  don't touch services (typical for forms that don't expose them). */
  serviceGroupIds: z.array(z.string()).optional(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type UpdateEntityInput = z.input<typeof UpdateEntityInputSchema>;

export async function updateEntity(input: UpdateEntityInput) {
  const parsed = UpdateEntityInputSchema.parse(input);
  const db = getDb();

  const operatingStates = Array.from(
    new Set(
      [parsed.homeState, ...parsed.operatingStates].filter(
        (s): s is string => Boolean(s),
      ),
    ),
  );

  const [row] = await db
    .update(entities)
    .set({
      name: parsed.name,
      entityType: parsed.entityType,
      homeState: parsed.homeState || null,
      operatingStates,
      ein: parsed.ein || null,
      // Conditional spread — only override fiscalYearEnd when the
      // caller actually supplied one. Forms that don't render the
      // FYE picker (older edit dialogs) won't accidentally reset
      // the value to default.
      ...(parsed.fiscalYearEnd ? { fiscalYearEnd: parsed.fiscalYearEnd } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(entities.id, parsed.id), eq(entities.orgId, parsed.orgId)))
    .returning();

  if (!row) throw new Error(`Entity ${parsed.id} not found`);

  // Service-group changes — only when caller supplied an explicit
  // list. We re-materialize deadlines if anything actually changed so
  // newly-added services produce their rules' deadlines and removed
  // services don't leave orphan instances surface in lists. (We don't
  // hard-delete existing instances — those carry status/notes/audit
  // history and may already be filed; the caller can archive them
  // manually.)
  if (parsed.serviceGroupIds) {
    const diff = await setEntityServices({
      entityId: row.id,
      orgId: parsed.orgId,
      desiredServiceIds: parsed.serviceGroupIds,
      actorType: parsed.actorType,
      actorId: parsed.actorId,
    });
    if (diff.added.length > 0) {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      for (const taxYear of [currentYear - 1, currentYear]) {
        await generateDeadlinesForEntity(
          {
            orgId: parsed.orgId,
            entityId: row.id,
            taxYear,
            actorType: parsed.actorType,
            actorId: parsed.actorId,
            includeHistoricalAsCompleted: false,
          },
          row,
        );
      }
    }
  }

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "entity.updated",
    targetType: "entity",
    targetId: row.id,
    payload: { name: parsed.name, entityType: parsed.entityType },
  });

  return row;
}

export const ArchiveEntityInputSchema = z.object({
  id: z.string().min(1),
  orgId: z.string(),
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
});
export type ArchiveEntityInput = z.input<typeof ArchiveEntityInputSchema>;

export async function archiveEntity(input: ArchiveEntityInput) {
  const parsed = ArchiveEntityInputSchema.parse(input);
  const db = getDb();

  const [row] = await db
    .update(entities)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(entities.id, parsed.id), eq(entities.orgId, parsed.orgId)))
    .returning();

  if (!row) throw new Error(`Entity ${parsed.id} not found`);

  await recordAudit({
    orgId: parsed.orgId,
    actorType: parsed.actorType,
    actorId: parsed.actorId,
    action: "entity.archived",
    targetType: "entity",
    targetId: row.id,
  });

  return row;
}

export async function listEntitiesForClient(input: ListEntitiesInput): Promise<Entity[]> {
  const parsed = ListEntitiesInputSchema.parse(input);
  const db = getDb();

  return db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.orgId, parsed.orgId),
        parsed.clientId ? eq(entities.clientId, parsed.clientId) : undefined,
        isNull(entities.archivedAt),
      ),
    );
}
