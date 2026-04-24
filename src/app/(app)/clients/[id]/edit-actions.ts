"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import { updateClient, archiveClient } from "@/lib/services/clients";
import { updateEntity, archiveEntity } from "@/lib/services/entities";

// ---- Client edit / archive ----------------------------------------------

const UpdateClientFormSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  primaryContactEmail: z.string().email().optional().or(z.literal("")),
  primaryContactPhone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
});

export async function updateClientAction(formData: FormData) {
  const ctx = await getCurrentContext();

  const parsed = UpdateClientFormSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    primaryContactEmail: (formData.get("primaryContactEmail") as string) || "",
    primaryContactPhone: (formData.get("primaryContactPhone") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  await updateClient({
    ...parsed.data,
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath(`/clients/${parsed.data.id}`);
  revalidatePath("/clients");
}

export async function archiveClientAction(clientId: string) {
  const ctx = await getCurrentContext();
  await archiveClient({
    id: clientId,
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

// ---- Entity edit / archive ----------------------------------------------

const UpdateEntityFormSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  entityType: z.enum([
    "individual",
    "c_corp",
    "s_corp",
    "partnership",
    "llc",
    "trust",
    "estate",
    "nonprofit",
  ]),
  homeState: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .optional()
    .or(z.literal("")),
  operatingStates: z.string().optional(),
  ein: z.string().max(20).optional(),
});

export async function updateEntityAction(formData: FormData) {
  const ctx = await getCurrentContext();

  const parsed = UpdateEntityFormSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    entityType: formData.get("entityType"),
    homeState: ((formData.get("homeState") as string) || "").toUpperCase(),
    operatingStates: (formData.get("operatingStates") as string) || "",
    ein: (formData.get("ein") as string) || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const operatingStates = (parsed.data.operatingStates ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));

  await updateEntity({
    id: parsed.data.id,
    orgId: ctx.organization.id,
    name: parsed.data.name,
    entityType: parsed.data.entityType,
    homeState: parsed.data.homeState || undefined,
    operatingStates,
    ein: parsed.data.ein || undefined,
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

export async function archiveEntityAction(entityId: string) {
  const ctx = await getCurrentContext();
  await archiveEntity({
    id: entityId,
    orgId: ctx.organization.id,
    actorType: "user",
    actorId: ctx.user.id,
  });
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}
