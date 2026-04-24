"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import { createClient } from "@/lib/services/clients";
import { createEntity } from "@/lib/services/entities";

const CreateClientFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  primaryContactEmail: z.string().email().or(z.literal("")).optional(),
  primaryContactPhone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
});

export async function createClientAction(formData: FormData) {
  const ctx = await getCurrentContext();

  const parsed = CreateClientFormSchema.safeParse({
    name: formData.get("name"),
    primaryContactEmail: formData.get("primaryContactEmail") || undefined,
    primaryContactPhone: formData.get("primaryContactPhone") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const client = await createClient({
    orgId: ctx.organization.id,
    name: parsed.data.name,
    primaryContactEmail: parsed.data.primaryContactEmail || undefined,
    primaryContactPhone: parsed.data.primaryContactPhone || undefined,
    notes: parsed.data.notes || undefined,
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath("/dashboard");
  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

const CreateEntityFormSchema = z.object({
  clientId: z.string().min(1),
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
  operatingStates: z.string().optional(), // comma-separated
  ein: z.string().max(20).optional(),
});

export async function createEntityAction(formData: FormData) {
  const ctx = await getCurrentContext();

  const parsed = CreateEntityFormSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name"),
    entityType: formData.get("entityType"),
    homeState: (formData.get("homeState") || "").toString().toUpperCase(),
    operatingStates: formData.get("operatingStates") || "",
    ein: formData.get("ein") || undefined,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const operatingStates = (parsed.data.operatingStates ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));

  await createEntity({
    orgId: ctx.organization.id,
    clientId: parsed.data.clientId,
    name: parsed.data.name,
    entityType: parsed.data.entityType,
    homeState: parsed.data.homeState || undefined,
    operatingStates,
    ein: parsed.data.ein || undefined,
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${parsed.data.clientId}`);
  redirect(`/clients/${parsed.data.clientId}`);
}
