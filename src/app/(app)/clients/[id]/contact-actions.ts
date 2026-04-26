"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  createContact,
  updateContact,
  archiveContact,
  setContactAsPrimary,
} from "@/lib/services/client-contacts";

const CreateFormSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().max(120).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
  receivesReminders: z.string().optional(),
  setPrimary: z.string().optional(),
});

const UpdateFormSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(120).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
  receivesReminders: z.string().optional(),
});

export async function createContactAction(formData: FormData) {
  const ctx = await getCurrentContext();
  const parsed = CreateFormSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    role: formData.get("role") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    receivesReminders: formData.get("receivesReminders") ?? undefined,
    setPrimary: formData.get("setPrimary") ?? undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  await createContact({
    orgId: ctx.organization.id,
    clientId: parsed.data.clientId,
    name: parsed.data.name?.trim() || null,
    email: parsed.data.email?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
    role: parsed.data.role?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
    receivesReminders: parsed.data.receivesReminders === "on",
    priority: parsed.data.setPrimary === "on" ? 0 : undefined,
    actorId: ctx.user.id,
  });

  revalidatePath(`/clients/${parsed.data.clientId}`);
}

export async function updateContactAction(formData: FormData) {
  const ctx = await getCurrentContext();
  const parsed = UpdateFormSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name") ?? undefined,
    email: formData.get("email") ?? undefined,
    phone: formData.get("phone") ?? undefined,
    role: formData.get("role") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    receivesReminders: formData.get("receivesReminders") ?? undefined,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const clientId = formData.get("clientId");

  await updateContact({
    id: parsed.data.id,
    orgId: ctx.organization.id,
    name: parsed.data.name?.trim() || null,
    email: parsed.data.email?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
    role: parsed.data.role?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
    receivesReminders: parsed.data.receivesReminders === "on",
    actorId: ctx.user.id,
  });

  if (typeof clientId === "string") revalidatePath(`/clients/${clientId}`);
}

export async function archiveContactAction(args: {
  id: string;
  clientId: string;
}) {
  const ctx = await getCurrentContext();
  await archiveContact({
    id: args.id,
    orgId: ctx.organization.id,
    actorId: ctx.user.id,
  });
  revalidatePath(`/clients/${args.clientId}`);
}

export async function setPrimaryAction(args: {
  id: string;
  clientId: string;
}) {
  const ctx = await getCurrentContext();
  await setContactAsPrimary({
    id: args.id,
    orgId: ctx.organization.id,
    actorId: ctx.user.id,
  });
  revalidatePath(`/clients/${args.clientId}`);
}
