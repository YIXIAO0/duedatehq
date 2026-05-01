/**
 * Workspace (multi-org) server actions:
 *   - acceptInvitationAction — already-signed-in user accepts an invite
 *     link. Creates the membership, sets the active-org cookie to the
 *     new workspace, clears the invite cookie, redirects to /dashboard.
 *
 *   - switchOrgAction — user with multiple memberships picks which one
 *     they're working in. Validates membership, writes the active-org
 *     cookie, refreshes via redirect.
 *
 * Both actions tolerate a stale / unknown cookie state by falling back
 * to a safe default (drop the cookie, /dashboard).
 */

"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import {
  ACTIVE_ORG_COOKIE_NAME,
  ACTIVE_ORG_COOKIE_MAX_AGE_SECONDS,
} from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";
import { users, memberships } from "@/lib/db/schema";
import {
  redeemInvitationForExistingUser,
  listMembershipsByUserId,
} from "@/lib/services/organizations";

const INVITE_COOKIE_NAME = "dd_invite_token";

function setActiveOrgCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  orgId: string,
) {
  cookieStore.set(ACTIVE_ORG_COOKIE_NAME, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ACTIVE_ORG_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

/**
 * Accept invitation as an already-signed-in user. Idempotent: returns
 * gracefully if the user is already a member of the invited org. Writes
 * the active-org cookie so the user lands inside the new workspace
 * (rather than their original one).
 *
 * No return — uses redirect() to navigate.
 */
export async function acceptInvitationAction(token: string): Promise<void> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    // Shouldn't happen — the form is only rendered when the user is
    // authenticated — but defensive guard against direct invocation.
    redirect("/sign-in");
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  if (!user) {
    // Edge: Clerk session valid but our user row hasn't been created
    // yet. Bounce them to /dashboard which triggers ensureUserAndOrg
    // (the slow path will redeem the invite via email match because
    // the dd_invite_token cookie is still set).
    redirect("/dashboard");
  }

  const result = await redeemInvitationForExistingUser({
    userId: user.id,
    token,
  });

  const cookieStore = await cookies();
  // Clear the short-lived invite cookie either way — it's been
  // consumed (or was invalid).
  cookieStore.delete(INVITE_COOKIE_NAME);

  if (result) {
    setActiveOrgCookie(cookieStore, result.organization.id);
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  // Token invalid / expired / already redeemed — fall back to home.
  redirect("/dashboard");
}

/**
 * Switch the active workspace. Validates that the caller actually
 * belongs to the requested org (otherwise a manually-tampered request
 * could pin the cookie to an org the user doesn't have access to;
 * findUserAndOrgByClerkId would then fall back to oldest, but we'd
 * still write the bad cookie).
 *
 * Refreshes the layout via revalidatePath so all server components
 * re-fetch under the new orgId.
 */
export async function switchOrgAction(orgId: string): Promise<void> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect("/sign-in");

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  if (!user) redirect("/sign-in");

  // Cheap membership check — single indexed lookup. We trust this and
  // skip the listMembershipsByUserId roundtrip for the happy path.
  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);
  void membership;

  // Authoritative check: list all memberships and confirm orgId is in
  // there. Cheap relative to the redirect.
  const allMemberships = await listMembershipsByUserId(user.id);
  if (!allMemberships.some((m) => m.organization.id === orgId)) {
    // Not a member — likely stale data on the client. Drop them on
    // /dashboard with whatever the cookie / fallback resolves to.
    redirect("/dashboard");
  }

  const cookieStore = await cookies();
  setActiveOrgCookie(cookieStore, orgId);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
