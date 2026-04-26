/**
 * iCal subscription token lifecycle.
 *
 * The token is a 24-byte URL-safe random string stored on the
 * `memberships` row. It serves as bearer auth for the public
 * /api/ical/[token].ics endpoint that calendar clients pull on a
 * schedule. We treat the token like a password:
 *   - generated server-side only (never client-side, even though
 *     it's bearer-only auth — keeps it out of browser history /
 *     network tab on the issuer's machine)
 *   - rotated by overwriting (no "previous tokens" list — Google Cal
 *     refreshes are frequent enough that 24h overlap isn't worth
 *     the complexity)
 *   - revoked by setting NULL
 */

import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { memberships, organizations, users } from "@/lib/db/schema";
import { recordAudit } from "./audit";

function newToken(): string {
  // 24 bytes → 32 char base64url. Plenty of entropy (192 bits) and
  // produces a token that's URL-pasteable without escaping.
  return randomBytes(24).toString("base64url");
}

/**
 * Read the current token for (user, org) without modifying anything.
 * Returns null if no subscription has been set up yet.
 */
export async function getIcalToken(args: {
  userId: string;
  orgId: string;
}): Promise<string | null> {
  const db = getDb();
  const [m] = await db
    .select({ token: memberships.icalToken })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, args.userId),
        eq(memberships.orgId, args.orgId),
      ),
    )
    .limit(1);
  return m?.token ?? null;
}

/**
 * Generate a new token, replacing any existing one. Used both for
 * first-time setup and explicit rotation.
 */
export async function rotateIcalToken(args: {
  userId: string;
  orgId: string;
}): Promise<string> {
  const db = getDb();
  const token = newToken();
  await db
    .update(memberships)
    .set({ icalToken: token })
    .where(
      and(
        eq(memberships.userId, args.userId),
        eq(memberships.orgId, args.orgId),
      ),
    );

  // Audit target is the user themselves — they're rotating their own
  // subscription token, scoped to this org. Membership.id would be
  // marginally more precise but costs a lookup; user.id is enough to
  // trace "who turned on/off iCal" in the audit log.
  await recordAudit({
    orgId: args.orgId,
    actorType: "user",
    actorId: args.userId,
    action: "ical.token_rotated",
    targetType: "user",
    targetId: args.userId,
    payload: {},
  });

  return token;
}

/** Disable the subscription URL — next refresh will 404. */
export async function revokeIcalToken(args: {
  userId: string;
  orgId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(memberships)
    .set({ icalToken: null })
    .where(
      and(
        eq(memberships.userId, args.userId),
        eq(memberships.orgId, args.orgId),
      ),
    );

  await recordAudit({
    orgId: args.orgId,
    actorType: "user",
    actorId: args.userId,
    action: "ical.token_revoked",
    targetType: "user",
    targetId: args.userId,
    payload: {},
  });
}

/**
 * Resolve a public token (from the URL) back to the membership it
 * belongs to. Used by the unauthenticated /api/ical/[token] handler.
 *
 * Returns null when the token doesn't match — never tells the caller
 * which kind of mismatch (revoked vs typo vs different user) so
 * scanners can't enumerate.
 */
export async function resolveIcalToken(token: string): Promise<{
  userId: string;
  orgId: string;
  orgName: string;
  userFullName: string | null;
  userEmail: string;
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      userId: memberships.userId,
      orgId: memberships.orgId,
      orgName: organizations.name,
      userFullName: users.fullName,
      userEmail: users.email,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.icalToken, token))
    .limit(1);
  return row ?? null;
}
