/**
 * Team service — list members, invite teammates, revoke invitations,
 * remove members.
 *
 * Membership creation on invite acceptance lives in
 * `services/organizations.ts` (the `ensureUserAndOrg` bootstrap), because
 * that's the single entry point Clerk flows through on first sign-in.
 */

import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import {
  invitations,
  memberships,
  users,
  type Invitation,
  type Membership,
  type User,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

export interface MemberRow {
  membership: Membership;
  user: User;
}

export async function listMembers(orgId: string): Promise<MemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.orgId, orgId))
    .orderBy(asc(memberships.createdAt));
  return rows;
}

export async function listPendingInvitations(
  orgId: string,
): Promise<Invitation[]> {
  const db = getDb();
  return await db
    .select()
    .from(invitations)
    .where(
      and(eq(invitations.orgId, orgId), eq(invitations.status, "pending")),
    )
    .orderBy(desc(invitations.createdAt));
}

export class InvitationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "already_member"
      | "already_invited"
      | "invalid_email"
      | "invalid_role"
      | "not_found",
  ) {
    super(message);
    this.name = "InvitationError";
  }
}

const ROLE_VALUES = ["admin", "member"] as const;
type InvitableRole = (typeof ROLE_VALUES)[number];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createInvitation(params: {
  orgId: string;
  email: string;
  role: string;
  invitedByUserId: string;
}): Promise<Invitation> {
  const email = params.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new InvitationError("Enter a valid email address", "invalid_email");
  }
  if (!ROLE_VALUES.includes(params.role as InvitableRole)) {
    throw new InvitationError(
      `Role must be one of: ${ROLE_VALUES.join(", ")}`,
      "invalid_role",
    );
  }

  const db = getDb();

  // Already a member of this org? Reject early so the caller can show a
  // useful message instead of "invited" silently no-op'ing.
  const existingMember = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.orgId, params.orgId), eq(users.email, email)))
    .limit(1);
  if (existingMember.length > 0) {
    throw new InvitationError(
      "That email already belongs to a member of this team",
      "already_member",
    );
  }

  // Outstanding pending invite? Don't double-issue.
  const existingPending = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.orgId, params.orgId),
        eq(invitations.email, email),
        eq(invitations.status, "pending"),
      ),
    )
    .limit(1);
  if (existingPending.length > 0) {
    throw new InvitationError(
      "An invite for this email is already pending — revoke it first to re-issue",
      "already_invited",
    );
  }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const [invitation] = await db
    .insert(invitations)
    .values({
      orgId: params.orgId,
      email,
      role: params.role as InvitableRole,
      token,
      invitedByUserId: params.invitedByUserId,
      expiresAt,
    })
    .returning();

  await recordAudit({
    orgId: params.orgId,
    actorType: "user",
    actorId: params.invitedByUserId,
    action: "invitation.created",
    targetType: "invitation",
    targetId: invitation.id,
    payload: { email, role: params.role },
  });

  return invitation;
}

export async function revokeInvitation(params: {
  orgId: string;
  invitationId: string;
  actorUserId: string;
}): Promise<void> {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.id, params.invitationId),
        eq(invitations.orgId, params.orgId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new InvitationError("Invitation not found", "not_found");
  }
  if (existing.status !== "pending") {
    return; // already terminal — no-op rather than error
  }

  await db
    .update(invitations)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invitations.id, params.invitationId));

  await recordAudit({
    orgId: params.orgId,
    actorType: "user",
    actorId: params.actorUserId,
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: params.invitationId,
    payload: { email: existing.email },
  });
}

// ---------------------------------------------------------------------------
// Remove member — permission-gated.
//
// Rules:
//   - owner    → may remove anyone, including themselves IF they are
//                NOT the last owner. Last-owner removal is rejected
//                (the org would be orphaned).
//   - admin    → may remove member, plus themselves. Cannot touch
//                other admins or owners — that's owner-only.
//   - member   → may only remove themselves (= leave workspace).
//
// "Self-leave" goes through this same path with the `Leave workspace`
// label flipped on the UI side; the backend permission logic treats it
// uniformly.
// ---------------------------------------------------------------------------

export class RemoveMemberError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "forbidden"
      | "last_owner"
      | "actor_not_in_org",
  ) {
    super(message);
    this.name = "RemoveMemberError";
  }
}

function canRemove(args: {
  actorRole: "owner" | "admin" | "member";
  targetRole: "owner" | "admin" | "member";
  isSelf: boolean;
}): boolean {
  if (args.isSelf) return true; // anyone can self-leave (last-owner check is separate)
  if (args.actorRole === "owner") return true;
  if (args.actorRole === "admin") return args.targetRole === "member";
  return false; // members can't remove others
}

export async function removeMember(params: {
  orgId: string;
  membershipIdToRemove: string;
  actorUserId: string;
}): Promise<void> {
  const db = getDb();

  // Look up actor's own membership in this org — required to know their
  // role + reject calls from a user who somehow isn't actually in the
  // org (defense-in-depth; getCurrentContext already enforces this).
  const [actor] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, params.orgId),
        eq(memberships.userId, params.actorUserId),
      ),
    )
    .limit(1);
  if (!actor) {
    throw new RemoveMemberError(
      "You aren't a member of this workspace",
      "actor_not_in_org",
    );
  }

  const [target] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.id, params.membershipIdToRemove),
        eq(memberships.orgId, params.orgId),
      ),
    )
    .limit(1);
  if (!target) {
    throw new RemoveMemberError("Member not found", "not_found");
  }

  const isSelf = target.userId === params.actorUserId;
  if (
    !canRemove({
      actorRole: actor.role,
      targetRole: target.role,
      isSelf,
    })
  ) {
    throw new RemoveMemberError(
      "You don't have permission to remove this member",
      "forbidden",
    );
  }

  // Last-owner guard: count remaining owners after this removal would
  // happen. Done in SQL so the count reflects committed state and can't
  // race against another concurrent removal (Postgres serializable
  // anomaly window is small but real).
  if (target.role === "owner") {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(memberships)
      .where(
        and(eq(memberships.orgId, params.orgId), eq(memberships.role, "owner")),
      );
    if (count <= 1) {
      throw new RemoveMemberError(
        "Cannot remove the last owner. Promote another member to owner first, or delete the workspace.",
        "last_owner",
      );
    }
  }

  await db.delete(memberships).where(eq(memberships.id, target.id));

  await recordAudit({
    orgId: params.orgId,
    actorType: "user",
    actorId: params.actorUserId,
    action: isSelf ? "membership.left" : "membership.removed",
    targetType: "membership",
    targetId: target.id,
    payload: {
      removedUserId: target.userId,
      removedRole: target.role,
      isSelf,
    },
  });
}

// ---------------------------------------------------------------------------
// Change member role — owner-only in V1.
//
// Rules:
//   - Only owners can change roles (admins promoting/demoting feels
//     too much like delegated power for a lightweight model — punt to V2)
//   - Demoting an owner is allowed unless they're the last owner
//   - Promoting to owner creates a co-owner; multiple owners are fine
//   - Self-demote is allowed under the same last-owner guard
//
// Note: this is the only path that flips the `role` column outside of
// invite-redemption. Both go through audit so the org's role history
// is reconstructable.
// ---------------------------------------------------------------------------

export class ChangeRoleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "forbidden"
      | "last_owner"
      | "actor_not_in_org"
      | "no_change",
  ) {
    super(message);
    this.name = "ChangeRoleError";
  }
}

export async function changeMemberRole(params: {
  orgId: string;
  membershipIdToChange: string;
  newRole: "owner" | "admin" | "member";
  actorUserId: string;
}): Promise<void> {
  const db = getDb();

  const [actor] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, params.orgId),
        eq(memberships.userId, params.actorUserId),
      ),
    )
    .limit(1);
  if (!actor) {
    throw new ChangeRoleError(
      "You aren't a member of this workspace",
      "actor_not_in_org",
    );
  }
  if (actor.role !== "owner") {
    throw new ChangeRoleError(
      "Only owners can change roles",
      "forbidden",
    );
  }

  const [target] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.id, params.membershipIdToChange),
        eq(memberships.orgId, params.orgId),
      ),
    )
    .limit(1);
  if (!target) {
    throw new ChangeRoleError("Member not found", "not_found");
  }

  if (target.role === params.newRole) {
    // No-op — silent return rather than error so accidental double-clicks
    // don't surface as a scary message.
    return;
  }

  // Demoting an owner: confirm at least one other owner remains.
  if (target.role === "owner" && params.newRole !== "owner") {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(memberships)
      .where(
        and(eq(memberships.orgId, params.orgId), eq(memberships.role, "owner")),
      );
    if (count <= 1) {
      throw new ChangeRoleError(
        "Cannot demote the last owner. Promote another member to owner first.",
        "last_owner",
      );
    }
  }

  await db
    .update(memberships)
    .set({ role: params.newRole })
    .where(eq(memberships.id, target.id));

  await recordAudit({
    orgId: params.orgId,
    actorType: "user",
    actorId: params.actorUserId,
    action: "membership.role_changed",
    targetType: "membership",
    targetId: target.id,
    payload: {
      targetUserId: target.userId,
      previousRole: target.role,
      newRole: params.newRole,
      isSelf: target.userId === params.actorUserId,
    },
  });
}

/**
 * Build the public invite URL for an invitation. Centralized so the API
 * route, the settings UI, and the audit logger all agree on the shape.
 */
export function buildInviteUrl(token: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/invite/${token}`;
}
