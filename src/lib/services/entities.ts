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
  actorType: z.enum(["user", "agent", "cron", "system"]).default("user"),
  actorId: z.string().nullable().default(null),
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
      },
      row,
    );
    created += stats.created;
  }

  return { entity: row, deadlinesCreated: created };
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
