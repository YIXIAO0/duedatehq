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
import { and, asc, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  invitations,
  memberships,
  organizations,
  users,
  type Invitation,
  type Membership,
  type Organization,
  type User,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

type Db = ReturnType<typeof getDb>;

/**
 * Fast-path lookup: returns the user + the active membership + that org
 * in a SINGLE round-trip via JOIN. Returns null when this Clerk user has
 * no internal user row yet (i.e., they need bootstrap).
 *
 * `activeOrgId` is read from the `dd_active_org_id` cookie — it lets a
 * user who belongs to multiple orgs pick which one they're currently
 * working in. When it's null, missing, or the user no longer belongs to
 * that org, we fall back to their oldest membership (deterministic so
 * solo users always land in the same place).
 *
 * Used by getCurrentContext on every authenticated page load. Replaces
 * a sequence of 3 sequential queries (find user → find membership →
 * find org), each its own HTTP round-trip via @neondatabase/serverless.
 *
 * Caller is also expected to skip the Clerk `currentUser()` API call
 * when this returns non-null — we already have email + fullName from
 * the local users row, so we don't need Clerk's slow REST fetch.
 */
export async function findUserAndOrgByClerkId(
  clerkUserId: string,
  activeOrgId?: string | null,
): Promise<{ user: User; organization: Organization; membership: Membership } | null> {
  const db = getDb();
  const rows = await db
    .select({
      user: users,
      membership: memberships,
      organization: organizations,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(users.clerkUserId, clerkUserId))
    .orderBy(asc(memberships.createdAt));

  if (rows.length === 0) return null;
  if (activeOrgId) {
    const match = rows.find((r) => r.organization.id === activeOrgId);
    if (match) return match;
  }
  // Cookie absent / stale / pointing at an org the user no longer
  // belongs to → fall back to oldest membership (most likely their
  // "home" org).
  return rows[0];
}

/**
 * Org switcher data — every membership the user holds, with their org.
 * Used to render the workspace dropdown and validate switch requests.
 */
export async function listMembershipsByUserId(
  userId: string,
): Promise<Array<{ membership: Membership; organization: Organization }>> {
  const db = getDb();
  return await db
    .select({ membership: memberships, organization: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}

/**
 * Redeem a pending invitation for a user who is already signed in (i.e.,
 * has an existing user row + at least one membership somewhere).
 *
 * Different from the slow-path `ensureUserAndOrg` redemption because:
 *   - It runs from a server action triggered by the invitee clicking
 *     "Accept invitation" on /invite/<token>, not from the bootstrap
 *   - It does NOT create a user row — that already exists
 *   - It DOES allow the user to belong to multiple orgs simultaneously
 *     (this function is purely additive on the memberships table)
 *
 * Idempotent: returns the existing membership when the user is already
 * a member of the invited org, but still flips the invitation row to
 * accepted so the inviter sees it cleared from pending.
 *
 * Returns null when the token is invalid / expired / already redeemed.
 */
export async function redeemInvitationForExistingUser(params: {
  userId: string;
  token: string;
}): Promise<{ organization: Organization; membership: Membership } | null> {
  const db = getDb();
  const now = new Date();

  const [invitation] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token, params.token),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, now),
      ),
    )
    .limit(1);

  if (!invitation) return null;

  const [organization] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, invitation.orgId))
    .limit(1);

  if (!organization) return null;

  const [insertedMembership] = await db
    .insert(memberships)
    .values({
      userId: params.userId,
      orgId: invitation.orgId,
      role: invitation.role,
    })
    .onConflictDoNothing({
      target: [memberships.userId, memberships.orgId],
    })
    .returning();

  const membership =
    insertedMembership ??
    (
      await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, params.userId),
            eq(memberships.orgId, invitation.orgId),
          ),
        )
        .limit(1)
    )[0];

  await db
    .update(invitations)
    .set({
      status: "accepted",
      acceptedAt: now,
      acceptedByUserId: params.userId,
      updatedAt: now,
    })
    .where(eq(invitations.id, invitation.id));

  await recordAudit({
    orgId: organization.id,
    actorType: "user",
    actorId: params.userId,
    action: "invitation.accepted",
    targetType: "invitation",
    targetId: invitation.id,
    payload: {
      role: invitation.role,
      source: "existing-user",
      alreadyMember: !insertedMembership,
    },
  });

  return { organization, membership };
}

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
  /**
   * Tokenized invitation from /invite/<token> sign-up. When present, takes
   * precedence over the email-match fallback — the token is canonical, and
   * the inviter explicitly granted access to the resolved org.
   */
  invitationToken?: string | null;
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
  // Use onConflictDoUpdate as belt-and-suspenders — guards against any
  // remaining race condition across requests (e.g. two browser tabs
  // opened simultaneously before the first-login bootstrap completes).
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
      .onConflictDoUpdate({
        target: users.clerkUserId,
        set: {
          email: params.email,
          fullName: params.fullName ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    user = inserted;
  }

  // 3) Before creating a fresh solo org, see if this user is redeeming an
  //    invitation. Token from /invite/<token> link is canonical; we fall
  //    back to email-match so users who lost the link still get attached.
  const invitation = await findRedeemableInvitation(db, {
    token: params.invitationToken ?? null,
    email: params.email.toLowerCase(),
  });

  if (invitation) {
    const [invitedOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, invitation.orgId))
      .limit(1);

    if (invitedOrg) {
      const [insertedMembership] = await db
        .insert(memberships)
        .values({
          userId: user.id,
          orgId: invitedOrg.id,
          role: invitation.role,
        })
        .onConflictDoNothing({
          target: [memberships.userId, memberships.orgId],
        })
        .returning();

      // onConflictDoNothing returns nothing on a hit; re-read in that case
      // so the caller always gets a Membership row.
      const finalMembership =
        insertedMembership ??
        (
          await db
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.userId, user.id),
                eq(memberships.orgId, invitedOrg.id),
              ),
            )
            .limit(1)
        )[0];

      await db
        .update(invitations)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          acceptedByUserId: user.id,
          updatedAt: new Date(),
        })
        .where(eq(invitations.id, invitation.id));

      await recordAudit({
        orgId: invitedOrg.id,
        actorType: "user",
        actorId: user.id,
        action: "invitation.accepted",
        targetType: "invitation",
        targetId: invitation.id,
        payload: {
          role: invitation.role,
          source: params.invitationToken ? "token" : "email-match",
        },
      });

      return {
        user,
        organization: invitedOrg,
        membership: finalMembership,
        created: true,
      };
    }
  }

  // 4) No invitation → fresh solo org with this user as owner.
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
    .onConflictDoNothing({
      target: [memberships.userId, memberships.orgId],
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
 * Resolve the most appropriate redeemable invitation for a freshly-signed-up
 * user. Token wins when present (the inviter explicitly granted access);
 * otherwise we look for any pending non-expired invitation matching the
 * user's email.
 *
 * Returns the oldest matching invitation if multiple email-matches exist —
 * stable ordering avoids flapping between cron retries.
 */
async function findRedeemableInvitation(
  db: Db,
  args: { token: string | null; email: string },
): Promise<Invitation | null> {
  const now = new Date();

  if (args.token) {
    const [byToken] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.token, args.token),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, now),
        ),
      )
      .limit(1);
    if (byToken) return byToken;
  }

  const [byEmail] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.email, args.email),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, now),
      ),
    )
    .orderBy(asc(invitations.createdAt))
    .limit(1);
  return byEmail ?? null;
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
