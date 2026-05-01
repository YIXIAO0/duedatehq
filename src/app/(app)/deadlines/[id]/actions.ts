"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  markCompleted,
  fileExtension,
  updateDeadlineNotes,
  reopenDeadline,
  setDeadlineStatus,
  assignDeadline,
} from "@/lib/services/deadlines";

const IdSchema = z.string().min(1);

// Mirror of WORKFLOW_STATUSES from the service. Kept in lock-step manually
// rather than imported because server-action arg types must be plain
// JSON-friendly literals to make Next.js's RPC encoding happy.
const WorkflowStatusSchema = z.enum([
  "pending",
  "waiting_on_client",
  "in_progress",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export async function markCompleteAction(
  deadlineId: string,
  notes?: string,
) {
  const ctx = await getCurrentContext();
  await markCompleted({
    deadlineInstanceId: IdSchema.parse(deadlineId),
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
    notes,
  });
  revalidatePath("/dashboard");
  revalidatePath(`/deadlines/${deadlineId}`);
}

export async function reopenAction(deadlineId: string) {
  const ctx = await getCurrentContext();
  await reopenDeadline({
    deadlineInstanceId: IdSchema.parse(deadlineId),
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath("/dashboard");
  revalidatePath(`/deadlines/${deadlineId}`);
}

export async function setStatusAction(
  deadlineId: string,
  newStatus: WorkflowStatus,
) {
  const ctx = await getCurrentContext();
  await setDeadlineStatus({
    deadlineInstanceId: IdSchema.parse(deadlineId),
    orgId: ctx.organization.id,
    status: WorkflowStatusSchema.parse(newStatus),
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath("/dashboard");
  revalidatePath(`/deadlines/${deadlineId}`);
}

/**
 * Assign / unassign a deadline owner. Pass null to clear the assignment
 * (= move back to "unassigned, in queue"). Membership validation lives
 * in the service so a tampered request can't pin ownership outside the
 * caller's org.
 */
export async function assignDeadlineAction(
  deadlineId: string,
  ownerUserId: string | null,
) {
  const ctx = await getCurrentContext();
  await assignDeadline({
    deadlineInstanceId: IdSchema.parse(deadlineId),
    orgId: ctx.organization.id,
    ownerUserId: ownerUserId === null ? null : IdSchema.parse(ownerUserId),
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath("/dashboard");
  revalidatePath(`/deadlines/${deadlineId}`);
}

const FileExtensionFormSchema = z.object({
  deadlineId: z.string().min(1),
  newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).optional(),
});

export async function fileExtensionAction(formData: FormData) {
  const ctx = await getCurrentContext();

  const parsed = FileExtensionFormSchema.safeParse({
    deadlineId: formData.get("deadlineId"),
    newDueDate: formData.get("newDueDate"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  await fileExtension({
    deadlineInstanceId: parsed.data.deadlineId,
    orgId: ctx.organization.id,
    newDueDate: parsed.data.newDueDate,
    actorType: "user",
    actorId: ctx.user.id,
    notes: parsed.data.notes,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/deadlines/${parsed.data.deadlineId}`);
}

const UpdateNotesFormSchema = z.object({
  deadlineId: z.string().min(1),
  notes: z.string().max(2000),
});

export async function updateNotesAction(formData: FormData) {
  const ctx = await getCurrentContext();

  const parsed = UpdateNotesFormSchema.safeParse({
    deadlineId: formData.get("deadlineId"),
    notes: formData.get("notes") ?? "",
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  await updateDeadlineNotes({
    deadlineInstanceId: parsed.data.deadlineId,
    orgId: ctx.organization.id,
    notes: parsed.data.notes,
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath(`/deadlines/${parsed.data.deadlineId}`);
}
