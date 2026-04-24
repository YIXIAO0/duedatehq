"use server";

import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/lib/auth/current-org";
import { createClient } from "@/lib/services/clients";
import { createEntity } from "@/lib/services/entities";
import {
  ApplyImportInputSchema,
  type ApplyImportResult,
  type ApplyImportInput,
} from "@/lib/import/types";
import { recordAudit } from "@/lib/services/audit";

/**
 * Translate raw database / validation errors into CPA-friendly language
 * with an actionable next step.
 */
function translateImportError(raw: string): {
  message: string;
  suggestion: string | null;
} {
  // Drizzle: empty insert
  if (/values\(\) must be called with at least one value/i.test(raw)) {
    return {
      message:
        "No deadlines applied — this entity type may not have any rules covering its states yet.",
      suggestion:
        "The client was created, but you may want to open it and adjust the entity type or home state.",
    };
  }
  // Postgres: unique constraint
  if (/duplicate key.*unique constraint/i.test(raw)) {
    return {
      message: "A client with these details already exists.",
      suggestion: "Check your clients list — this one may be a duplicate.",
    };
  }
  // Zod: validation errors are usually self-explanatory, just clean up
  if (/^(invalid|expected|required)/i.test(raw)) {
    return {
      message: raw,
      suggestion:
        "Go back and adjust the column mapping or the source data for this row.",
    };
  }
  // Fallback
  return {
    message: raw,
    suggestion:
      "Try re-importing this row individually, or add it manually from the Clients page.",
  };
}

/**
 * Apply a batch of imported rows. Each row becomes 1 client + 1 entity.
 * Deadline generation is triggered automatically by createEntity().
 *
 * Non-transactional: if any row fails we skip it and continue. The result
 * summarizes what landed. This matches CPA expectations — they'd rather
 * import 80/82 than have all 82 roll back because of 2 bad rows.
 */
export async function applyImportAction(
  input: ApplyImportInput,
): Promise<ApplyImportResult> {
  const ctx = await getCurrentContext();
  const parsed = ApplyImportInputSchema.parse(input);

  const result: ApplyImportResult = {
    clientsCreated: 0,
    entitiesCreated: 0,
    deadlinesGenerated: 0,
    rowsSkipped: 0,
    errors: [],
  };

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i];
    try {
      // 1. Create client (one per row for MVP — user can merge later)
      const client = await createClient({
        orgId: ctx.organization.id,
        name: row.clientName,
        primaryContactEmail: row.contactEmail,
        primaryContactPhone: row.contactPhone,
        notes: row.notes,
        actorType: "user",
        actorId: ctx.user.id,
      });
      result.clientsCreated += 1;

      // 2. Create entity + auto-generate deadlines
      const entityResult = await createEntity({
        orgId: ctx.organization.id,
        clientId: client.id,
        name: row.entityName ?? row.clientName,
        entityType: row.entityType,
        homeState: row.homeState,
        operatingStates: row.operatingStates ?? [],
        ein: row.ein,
        actorType: "user",
        actorId: ctx.user.id,
        includeHistoricalAsCompleted: parsed.includeHistoricalAsCompleted,
      });
      result.entitiesCreated += 1;
      result.deadlinesGenerated += entityResult.deadlinesCreated;
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      const { message, suggestion } = translateImportError(rawMessage);
      result.rowsSkipped += 1;
      result.errors.push({
        rowIndex: i,
        clientName: row.clientName ?? null,
        message,
        suggestion,
      });
    }
  }

  await recordAudit({
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
    action: "bulk_import.applied",
    targetType: "organization",
    targetId: ctx.organization.id,
    payload: {
      totalRows: parsed.rows.length,
      ...result,
    },
  });

  revalidatePath("/clients");
  revalidatePath("/dashboard");

  return result;
}
