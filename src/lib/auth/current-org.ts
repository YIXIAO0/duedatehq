/**
 * Auth helper: resolve the current request's Clerk user → our internal
 * org + user rows (creating them on first login). Every protected page
 * and server action calls this to get their scoping IDs.
 */

import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  ensureUserAndOrg,
  findUserAndOrgByClerkId,
} from "@/lib/services/organizations";
import type { Organization, User } from "@/lib/db/schema";

const INVITE_COOKIE_NAME = "dd_invite_token";
export const ACTIVE_ORG_COOKIE_NAME = "dd_active_org_id";
// Active-org cookie outlives most sessions — 90 days is enough that a
// CPA who's only in one workspace never has to re-pick. The cookie is
// validated on every read (we fall back to oldest membership when the
// org id no longer matches an active membership), so a long TTL is
// safe.
export const ACTIVE_ORG_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export interface CurrentContext {
  user: User; // our internal row
  organization: Organization;
  clerkUserId: string;
  email: string;
}

/**
 * getCurrentContext is wrapped in React `cache()` so that parallel Server
 * Components in the same request (header + stats + upcoming list each
 * under its own <Suspense>) share a single DB round-trip and — critically —
 * a single `ensureUserAndOrg` invocation.
 *
 * Without this, first-sign-in requests trigger a race where multiple
 * parallel components each try to INSERT the same user row and hit the
 * clerk_user_id UNIQUE constraint.
 */
export const getCurrentContext = cache(
  async (): Promise<CurrentContext> => {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) redirect("/sign-in");

    // Fast path: this Clerk user already has a user+membership+org in our
    // DB. Single JOIN, no Clerk API call. Saves ~300-500ms vs the slow
    // path on every refresh of every authenticated page.
    //
    // The active-org cookie picks WHICH org for users who belong to
    // multiple. Stale / missing cookie falls back to the user's oldest
    // membership inside the service.
    //
    // Trade-off: when a Clerk user updates their email/name, our local
    // copy goes stale until they next hit the slow path (currently only
    // on first sign-in or via a future Clerk webhook). Acceptable for V1
    // — name/email changes are rare and a manual sign-out fixes it.
    const cookieStore = await cookies();
    const activeOrgId =
      cookieStore.get(ACTIVE_ORG_COOKIE_NAME)?.value ?? null;
    const fast = await findUserAndOrgByClerkId(clerkUserId, activeOrgId);
    if (fast) {
      return {
        user: fast.user,
        organization: fast.organization,
        clerkUserId,
        email: fast.user.email,
      };
    }

    // Slow path: first-login bootstrap. Need full Clerk user details to
    // create the user row, plus the optional invite cookie to redeem any
    // pending team invitation.
    const clerkUser = await currentUser();
    if (!clerkUser) redirect("/sign-in");

    const email = clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) {
      throw new Error(
        "Clerk user has no email address — cannot bootstrap org",
      );
    }

    const fullName =
      clerkUser.fullName ||
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      null;

    // Pull a pending invitation token from the cookie set by the
    // /invite/<token> landing page. The bootstrap reads it to attach this
    // freshly-signed-up user to the right org instead of spinning up a
    // solo one. Cookie has a 10-minute TTL — if it's expired by the time
    // we get here, the email-match fallback inside ensureUserAndOrg
    // still catches the invitation.
    //
    // (cookieStore was already read above for the active-org lookup.)
    const invitationToken =
      cookieStore.get(INVITE_COOKIE_NAME)?.value ?? null;

    const { user, organization } = await ensureUserAndOrg({
      clerkUserId,
      email,
      fullName,
      invitationToken,
    });

    return { user, organization, clerkUserId, email };
  },
);
