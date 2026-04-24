/**
 * Organization service — bootstraps a default org + membership for every
 * new Clerk user so the rest of the app (clients, entities, deadlines) has
 * a guaranteed owning org.
 *
 * Called from:
 *   - /api/webhooks/clerk on `user.created` event
 *   - A first-login fallback in the (app) layout if the webhook race-loses
 *
 * Idempotent: re-running for an existing Clerk user returns the existing row.
 */

import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  memberships,
  organizations,
  users,
  type Membership,
  type Organization,
  type User,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

export interface EnsureUserOrgResult {
  user: User;
  organization: Organization;
  membership: Membership;
  created: boolean;
}

export async function ensureUserAndOrg(params: {
  clerkUserId: string;
  email: string;
  fullName?: string | null;
}): Promise<EnsureUserOrgResult> {
  const db = getDb();

  // 1) Look up existing user
  const existingUsers = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, params.clerkUserId))
    .limit(1);

  if (existingUsers.length > 0) {
    const existingUser = existingUsers[0];
    const existingMembershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, existingUser.id))
      .limit(1);

    if (existingMembershipRows.length > 0) {
      const existingMembership = existingMembershipRows[0];
      const orgRows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, existingMembership.orgId))
        .limit(1);

      if (orgRows.length > 0) {
        return {
          user: existingUser,
          organization: orgRows[0],
          membership: existingMembership,
          created: false,
        };
      }
    }
  }

  // 2) Create user (if new) → org → membership
  let user: User;
  if (existingUsers.length > 0) {
    user = existingUsers[0];
  } else {
    const [inserted] = await db
      .insert(users)
      .values({
        clerkUserId: params.clerkUserId,
        email: params.email,
        fullName: params.fullName ?? null,
      })
      .returning();
    user = inserted;
  }

  const orgName = params.fullName
    ? `${params.fullName}'s practice`
    : `${params.email.split("@")[0]}'s practice`;

  const [organization] = await db
    .insert(organizations)
    .values({ name: orgName, plan: "beta" })
    .returning();

  const [membership] = await db
    .insert(memberships)
    .values({
      userId: user.id,
      orgId: organization.id,
      role: "owner",
    })
    .returning();

  await recordAudit({
    orgId: organization.id,
    actorType: "system",
    actorId: null,
    action: "organization.bootstrapped",
    targetType: "organization",
    targetId: organization.id,
    payload: { userId: user.id, source: "first-login" },
  });

  return { user, organization, membership, created: true };
}

/**
 * Convenience helper for route handlers / server components — given a
 * Clerk userId, return the owning organization. Creates on first call.
 */
export async function getOrCreateOrgForClerkUser(
  clerkUserId: string,
  fallbackEmail: string,
  fallbackName?: string | null,
): Promise<Organization> {
  const { organization } = await ensureUserAndOrg({
    clerkUserId,
    email: fallbackEmail,
    fullName: fallbackName,
  });
  return organization;
}
