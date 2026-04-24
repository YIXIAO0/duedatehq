/**
 * Auth helper: resolve the current request's Clerk user → our internal
 * org + user rows (creating them on first login). Every protected page
 * and server action calls this to get their scoping IDs.
 */

import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ensureUserAndOrg } from "@/lib/services/organizations";
import type { Organization, User } from "@/lib/db/schema";

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

    const { user, organization } = await ensureUserAndOrg({
      clerkUserId,
      email,
      fullName,
    });

    return { user, organization, clerkUserId, email };
  },
);
