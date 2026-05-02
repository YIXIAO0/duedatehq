"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  createSubtask,
  deleteSubtask,
  markSubtaskComplete,
  reopenSubtask,
  shiftSubtasksAfterExtension,
  updateSubtask,
} from "@/lib/services/subtasks";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LABEL_MAX = 120;

const CreateFormSchema = z.object({
  deadlineId: z.string().min(1),
  label: z.string().min(1).max(LABEL_MAX),
  dueDate: z.string().regex(ISO_DATE),
  // Empty string from <select> = "no specific owner, inherit from
  // deadline" — flatten it to null at the boundary so the service
  // stays strict about the {string | null} shape.
  ownerUserId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

export async function createSubtaskAction(formData: FormData) {
  const ctx = await getCurrentContext();
  const parsed = CreateFormSchema.safeParse({
    deadlineId: formData.get("deadlineId"),
    label: formData.get("label"),
    dueDate: formData.get("dueDate"),
    ownerUserId: formData.get("ownerUserId"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid stage input");
  }

  await createSubtask({
    deadlineInstanceId: parsed.data.deadlineId,
    orgId: ctx.organization.id,
    label: parsed.data.label,
    dueDate: parsed.data.dueDate,
    ownerUserId: parsed.data.ownerUserId ?? null,
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath(`/deadlines/${parsed.data.deadlineId}`);
  revalidatePath("/dashboard");
}

const UpdateInputSchema = z.object({
  subtaskId: z.string().min(1),
  deadlineId: z.string().min(1),
  label: z.string().min(1).max(LABEL_MAX).optional(),
  dueDate: z.string().regex(ISO_DATE).optional(),
  // Same null-vs-undefined distinction as the service layer.
  ownerUserId: z.union([z.string(), z.null()]).optional(),
});
export type UpdateSubtaskActionInput = z.input<typeof UpdateInputSchema>;

export async function updateSubtaskAction(input: UpdateSubtaskActionInput) {
  const ctx = await getCurrentContext();
  const parsed = UpdateInputSchema.parse(input);
  await updateSubtask({
    subtaskId: parsed.subtaskId,
    orgId: ctx.organization.id,
    label: parsed.label,
    dueDate: parsed.dueDate,
    ownerUserId: parsed.ownerUserId,
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath(`/deadlines/${parsed.deadlineId}`);
  revalidatePath("/dashboard");
}

export async function markSubtaskCompleteAction(input: {
  subtaskId: string;
  deadlineId: string;
}) {
  const ctx = await getCurrentContext();
  await markSubtaskComplete({
    subtaskId: input.subtaskId,
    orgId: ctx.organization.id,
    completedByUserId: ctx.user.id,
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath(`/deadlines/${input.deadlineId}`);
  revalidatePath("/dashboard");
}

export async function reopenSubtaskAction(input: {
  subtaskId: string;
  deadlineId: string;
}) {
  const ctx = await getCurrentContext();
  await reopenSubtask({
    subtaskId: input.subtaskId,
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath(`/deadlines/${input.deadlineId}`);
  revalidatePath("/dashboard");
}

export async function deleteSubtaskAction(input: {
  subtaskId: string;
  deadlineId: string;
}) {
  const ctx = await getCurrentContext();
  await deleteSubtask({
    subtaskId: input.subtaskId,
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath(`/deadlines/${input.deadlineId}`);
  revalidatePath("/dashboard");
}

const ShiftActionSchema = z.object({
  deadlineId: z.string().min(1),
  originalDueDate: z.string().regex(ISO_DATE),
  newDueDate: z.string().regex(ISO_DATE),
});

/**
 * Bulk-shift open stages after the parent deadline's due date moves.
 * Called from the "Keep / Shift stages?" prompt that surfaces after
 * filing an extension. Returns the count actually shifted so the UI
 * can show a confirmation toast.
 */
export async function shiftSubtasksAction(
  input: z.input<typeof ShiftActionSchema>,
): Promise<{ shifted: number }> {
  const ctx = await getCurrentContext();
  const parsed = ShiftActionSchema.parse(input);
  const shifted = await shiftSubtasksAfterExtension({
    deadlineInstanceId: parsed.deadlineId,
    orgId: ctx.organization.id,
    originalDueDate: parsed.originalDueDate,
    newDueDate: parsed.newDueDate,
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath(`/deadlines/${parsed.deadlineId}`);
  revalidatePath("/dashboard");
  return { shifted };
}
