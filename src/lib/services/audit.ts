/**
 * Audit service — every mutation routes through here.
 * Agent-ready: actorType can be "user" | "agent" | "cron" | "system".
 */

import "server-only";
import { getDb } from "@/lib/db";
import { auditEvents, type NewAuditEvent } from "@/lib/db/schema";

export interface RecordAuditInput {
  orgId: string;
  actorType: "user" | "agent" | "cron" | "system";
  actorId: string | null;
  action: string; // "client.created", "deadline.completed", "entity.archived", ...
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
}

export async function recordAudit(input: RecordAuditInput): Promise<void> {
  const db = getDb();
  const row: NewAuditEvent = {
    orgId: input.orgId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.payload ?? null,
  };
  await db.insert(auditEvents).values(row);
}
