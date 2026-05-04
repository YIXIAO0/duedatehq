/**
 * Entity tax elections — opt-in flags per (entity, jurisdiction, kind)
 * that gate visibility of election-only deadline rules.
 *
 * Currently the only kind is "pte" (Pass-Through Entity tax election).
 * Marking an entity as PTE-elected in CA causes CA-3893 and any other
 * `requires_election='pte'` rules in CA to start materializing into
 * deadline_instances on next generation.
 *
 * v1 keeps this thin: insert / delete / list. Hard-delete on revoke —
 * election history isn't load-bearing yet. Re-generation of deadlines
 * after a change is the caller's responsibility (typically the server
 * action wrapping this service).
 */

import "server-only";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  deadlineRules,
  entities,
  entityElections,
  type EntityElection,
} from "@/lib/db/schema";

export const ElectionKindSchema = z.enum(["pte"]);
export type ElectionKind = z.infer<typeof ElectionKindSchema>;

const ElectArgsSchema = z.object({
  orgId: z.string(),
  entityId: z.string(),
  jurisdictionCode: z.string().regex(/^[A-Z]{2}$/, "USPS 2-letter code"),
  kind: ElectionKindSchema,
});
export type ElectArgs = z.infer<typeof ElectArgsSchema>;

/**
 * Mark an entity as having made the given tax election in a given
 * state. Idempotent — re-marking is a no-op (unique index handles it).
 */
export async function electEntity(args: ElectArgs): Promise<void> {
  const parsed = ElectArgsSchema.parse(args);
  const db = getDb();
  await db
    .insert(entityElections)
    .values({
      orgId: parsed.orgId,
      entityId: parsed.entityId,
      jurisdictionCode: parsed.jurisdictionCode,
      kind: parsed.kind,
    })
    .onConflictDoNothing();
}

/**
 * Remove the election. Hard-delete; no audit trail in v1.
 * After this, the gated deadline rules stop showing for new generations,
 * but already-materialized deadline_instances remain (the CPA may still
 * want them in their historical record).
 */
export async function revokeElection(args: ElectArgs): Promise<void> {
  const parsed = ElectArgsSchema.parse(args);
  const db = getDb();
  await db
    .delete(entityElections)
    .where(
      and(
        eq(entityElections.entityId, parsed.entityId),
        eq(entityElections.jurisdictionCode, parsed.jurisdictionCode),
        eq(entityElections.kind, parsed.kind),
      ),
    );
}

/** All elections currently held by an entity. */
export async function listElectionsForEntity(
  entityId: string,
): Promise<EntityElection[]> {
  const db = getDb();
  return db
    .select()
    .from(entityElections)
    .where(eq(entityElections.entityId, entityId));
}

/**
 * Jurisdictions where a PTE election is meaningful — i.e. the seed
 * data has at least one `requires_election='pte'` rule for that state.
 * Used by the UI to know which checkboxes to show on the entity page.
 *
 * Pulled from DB (not a hardcoded constant) so adding more state PTE
 * rules to the seed automatically expands the UI without code changes.
 */
export async function getPteJurisdictions(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ jurisdictionCode: deadlineRules.jurisdictionCode })
    .from(deadlineRules)
    .where(eq(deadlineRules.requiresElection, "pte"));
  return rows.map((r) => r.jurisdictionCode).sort();
}

/**
 * For a given entity, which PTE jurisdictions can it actually elect?
 *
 * Eligibility:
 *   1. entity_type is s_corp / partnership / llc (only pass-throughs
 *      can elect PTE — sole-prop individuals can't, C-corps don't need
 *      to since they already pay corporate tax at entity level)
 *   2. The state must be in PTE-jurisdictions (has a seeded PTE rule)
 *   3. Entity must operate in that state (home_state OR operating_states
 *      intersects the PTE state)
 */
export async function eligiblePteJurisdictionsForEntity(
  entityId: string,
): Promise<string[]> {
  const db = getDb();
  const [entity] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  if (!entity) return [];

  // Rule 1 — only pass-throughs.
  if (!["s_corp", "partnership", "llc"].includes(entity.entityType)) {
    return [];
  }

  // Rule 2 — pull active PTE jurisdictions.
  const pteStates = await getPteJurisdictions();
  if (pteStates.length === 0) return [];

  // Rule 3 — intersect with entity's footprint.
  const entityFootprint = new Set<string>(
    [entity.homeState, ...(entity.operatingStates ?? [])].filter(
      (x): x is string => Boolean(x),
    ),
  );
  return pteStates.filter((s) => entityFootprint.has(s));
}
