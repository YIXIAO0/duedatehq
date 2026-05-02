"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  markCompleted,
  fileExtension,
  updateDeadlineNotes,
  reopenDeadline,
  assignDeadline,
  getDeadlineDetail,
} from "@/lib/services/deadlines";
import { countShiftableSubtasks } from "@/lib/services/subtasks";

const IdSchema = z.string().min(1);

// (WorkflowStatusSchema + setStatusAction removed 2026-05-01 — state is
// derived from completed_at, no workflow setter exists. Mark-as-filed
// and reopen still cover the only state transitions.)

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

/**
 * Returned to the client so the action bar knows whether to follow up
 * with the "Keep / Shift stages?" prompt. `originalDueDate` is the
 * pre-extension date — we capture it before fileExtension() mutates
 * the row so the stage shift uses the right anchor (extension_due_date
 * the SECOND time around if the deadline was already extended; otherwise
 * the base due_date).
 */
export type FileExtensionResult = {
  deadlineId: string;
  originalDueDate: string;
  newDueDate: string;
  shiftCandidates: number;
};

export async function fileExtensionAction(
  formData: FormData,
): Promise<FileExtensionResult> {
  const ctx = await getCurrentContext();

  const parsed = FileExtensionFormSchema.safeParse({
    deadlineId: formData.get("deadlineId"),
    newDueDate: formData.get("newDueDate"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  // Capture the deadline's effective due date BEFORE filing the
  // extension — this is the anchor the stage-shift logic uses to
  // decide which stages to move ("only stages dated on/after the
  // pre-extension deadline get shifted"). If we read it after, the
  // extension would have already overwritten extension_due_date and
  // the comparison would be a no-op.
  const pre = await getDeadlineDetail(parsed.data.deadlineId, ctx.organization.id);
  if (!pre) {
    throw new Error(`Deadline ${parsed.data.deadlineId} not found`);
  }
  const originalDueDate = pre.extension_due_date ?? pre.due_date;

  await fileExtension({
    deadlineInstanceId: parsed.data.deadlineId,
    orgId: ctx.organization.id,
    newDueDate: parsed.data.newDueDate,
    actorType: "user",
    actorId: ctx.user.id,
    notes: parsed.data.notes,
  });

  // How many open stages would the shift move? Powers the second
  // dialog. Zero = no prompt, just close the extension dialog.
  const shiftCandidates = await countShiftableSubtasks({
    deadlineInstanceId: parsed.data.deadlineId,
    orgId: ctx.organization.id,
    originalDueDate,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/deadlines/${parsed.data.deadlineId}`);

  return {
    deadlineId: parsed.data.deadlineId,
    originalDueDate,
    newDueDate: parsed.data.newDueDate,
    shiftCandidates,
  };
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
