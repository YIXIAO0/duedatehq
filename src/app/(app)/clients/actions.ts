"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentContext } from "@/lib/auth/current-org";
import {
  createClient,
  mergeClients,
  type MergeClientsResult,
} from "@/lib/services/clients";
import { createContact } from "@/lib/services/client-contacts";
import { createEntity } from "@/lib/services/entities";

const CreateClientWithSetupSchema = z.object({
  clientName: z.string().min(1, "Client name is required").max(200),
  clientNotes: z.string().max(2000).optional(),
  contactName: z.string().max(120).optional(),
  contactEmail: z.string().email("Enter a valid email"),
  contactPhone: z.string().max(50).optional(),
  entityName: z.string().min(1, "Entity name is required").max(200),
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
  entityHomeState: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .optional()
    .or(z.literal("")),
});

export type CreateClientWithSetupInput = z.infer<
  typeof CreateClientWithSetupSchema
>;

export async function createClientWithSetupAction(
  input: CreateClientWithSetupInput,
) {
  const ctx = await getCurrentContext();
  const parsed = CreateClientWithSetupSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const data = parsed.data;

  const client = await createClient({
    orgId: ctx.organization.id,
    name: data.clientName,
    primaryContactEmail: data.contactEmail,
    primaryContactPhone: data.contactPhone || undefined,
    notes: data.clientNotes || undefined,
    actorType: "user",
    actorId: ctx.user.id,
  });

  await createContact({
    orgId: ctx.organization.id,
    clientId: client.id,
    name: data.contactName?.trim() || null,
    email: data.contactEmail,
    phone: data.contactPhone?.trim() || null,
    role: null,
    notes: null,
    receivesReminders: true,
    priority: 0,
    actorId: ctx.user.id,
  });

  await createEntity({
    orgId: ctx.organization.id,
    clientId: client.id,
    name: data.entityName,
    entityType: data.entityType,
    homeState: data.entityHomeState || undefined,
    operatingStates: [],
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath("/dashboard");
  revalidatePath("/clients");
  redirect(`/clients/${client.id}`);
}

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
  // MM-DD format. Defaults to "12-31" (calendar year) at the service
  // layer if absent. We accept the empty string from forms that don't
  // submit the field at all (older code paths).
  fiscalYearEnd: z
    .string()
    .regex(/^\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
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
    fiscalYearEnd: formData.get("fiscalYearEnd") || "",
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const operatingStates = (parsed.data.operatingStates ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));

  // Service-group selection — the form sends one hidden input per
  // checked service. getAll() reads them all.
  // When the form was rendered without any services (older clients
  // without the new picker), we leave this empty and let createEntity
  // fall back to the entity-type defaults.
  const rawServiceIds = formData.getAll("serviceGroupIds");
  const serviceGroupIds = rawServiceIds
    .map((v) => (typeof v === "string" ? v : ""))
    .filter((v) => v.length > 0);

  await createEntity({
    orgId: ctx.organization.id,
    clientId: parsed.data.clientId,
    name: parsed.data.name,
    entityType: parsed.data.entityType,
    homeState: parsed.data.homeState || undefined,
    operatingStates,
    ein: parsed.data.ein || undefined,
    fiscalYearEnd: parsed.data.fiscalYearEnd || undefined,
    // Pass-through only when the form supplied a list (any length,
    // including 0 = explicit "no services"). Undefined = fall back.
    serviceGroupIds: rawServiceIds.length > 0 ? serviceGroupIds : undefined,
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${parsed.data.clientId}`);
  redirect(`/clients/${parsed.data.clientId}`);
}

// ---------------------------------------------------------------------------
// Merge clients — called from /clients when the user selects 2+ clients
// and confirms the merge dialog. Returns the result so the client can show
// a toast like "Merged 3 clients into Sarah Johnson (2 entities moved)".
// ---------------------------------------------------------------------------

export async function mergeClientsAction(args: {
  primaryId: string;
  mergeIds: string[];
}): Promise<MergeClientsResult> {
  const ctx = await getCurrentContext();

  const result = await mergeClients({
    orgId: ctx.organization.id,
    primaryId: args.primaryId,
    mergeIds: args.mergeIds,
    actorType: "user",
    actorId: ctx.user.id,
  });

  revalidatePath("/clients");
  revalidatePath("/dashboard");
  revalidatePath(`/clients/${result.primaryId}`);

  return result;
}
