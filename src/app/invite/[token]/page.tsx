/**
 * Public invitation landing page — /invite/<token>.
 *
 * Two flows depending on auth state:
 *
 *   (A) Visitor NOT signed in
 *       Click "Continue to sign up" → set short-lived dd_invite_token
 *       cookie → redirect to /sign-up. After Clerk creates the account,
 *       ensureUserAndOrg's slow path reads the cookie and attaches the
 *       new user to the invited org as an additional membership.
 *
 *   (B) Visitor ALREADY signed in (existing DueDateHQ user)
 *       Click "Accept invitation" → server action redeems the invite
 *       directly via redeemInvitationForExistingUser, switches the
 *       active-org cookie to the new workspace, redirects to /dashboard.
 *       This is what fixes the bug where an existing user clicking an
 *       invite link silently bounced back to their original org.
 *
 * Invalid / expired / revoked tokens render a friendly error card in
 * either flow.
 */

import "server-only";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gt } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { invitations, organizations, users } from "@/lib/db/schema";
import { acceptInvitationAction } from "@/app/(app)/workspace-actions";

const INVITE_COOKIE_NAME = "dd_invite_token";
const INVITE_COOKIE_TTL_SECONDS = 10 * 60;

type Params = Promise<{ token: string }>;

// Cache Components: outer page stays static; the Suspense boundary
// encapsulates everything dynamic (DB lookup + auth() + cookies()) so
// the build can prerender the shell without invoking those at build
// time. `export const dynamic` is forbidden under cacheComponents —
// Suspense is the right primitive here.
export default function InvitationPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<InvitationSkeleton />}>
      <InvitationResolver params={params} />
    </Suspense>
  );
}

async function InvitationResolver({ params }: { params: Params }) {
  const { token } = await params;

  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select({
      invitation: invitations,
      organization: organizations,
      inviter: users,
    })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .leftJoin(users, eq(users.id, invitations.invitedByUserId))
    .where(
      and(
        eq(invitations.token, token),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) {
    return <InvalidInvite />;
  }

  // Flow split: if the visitor is already authenticated, render the
  // "Accept" form which redeems directly. Otherwise render the original
  // "Continue to sign up" form that goes through Clerk first.
  const { userId: clerkUserId } = await auth();
  const isAuthenticated = clerkUserId != null;

  return (
    <ValidInvite
      orgName={row.organization.name}
      inviterName={row.inviter?.fullName ?? row.inviter?.email ?? null}
      email={row.invitation.email}
      role={row.invitation.role}
      expiresAt={row.invitation.expiresAt}
      token={token}
      isAuthenticated={isAuthenticated}
    />
  );
}

function InvitationSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="h-[420px] w-full max-w-md animate-pulse rounded-lg bg-card shadow-sm" />
    </div>
  );
}

function InvalidInvite() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>This invitation isn&apos;t valid</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            The link may have expired, been revoked, or already been used.
            Ask whoever invited you to send a fresh link.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href="/">Back to home</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ValidInvite({
  orgName,
  inviterName,
  email,
  role,
  expiresAt,
  token,
  isAuthenticated,
}: {
  orgName: string;
  inviterName: string | null;
  email: string;
  role: "owner" | "admin" | "member";
  expiresAt: Date;
  token: string;
  isAuthenticated: boolean;
}) {
  // Unauthenticated path — set the cookie + bounce to /sign-up. The
  // bootstrap reads the cookie post-signup and attaches the new user.
  async function startSignup() {
    "use server";
    const cookieStore = await cookies();
    cookieStore.set(INVITE_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: INVITE_COOKIE_TTL_SECONDS,
      path: "/",
    });
    redirect(`/sign-up?invite=1`);
  }

  // Authenticated path — bind the action's first arg so the server
  // action receives the token without needing a hidden input.
  const acceptAsExistingUser = acceptInvitationAction.bind(null, token);

  const expiresIn = relativeFromNow(expiresAt);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">
            You&apos;re invited to join {orgName}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5 text-sm">
            <Row label="Invited as" value={email} />
            <Row
              label="Role"
              value={
                <Badge variant="outline" className="text-[10px] uppercase">
                  {role}
                </Badge>
              }
            />
            {inviterName ? <Row label="Invited by" value={inviterName} /> : null}
            <Row label="Expires" value={expiresIn} />
          </div>

          {isAuthenticated ? (
            <>
              <p className="text-sm text-muted-foreground">
                You&apos;re already signed in. Accepting will add{" "}
                <strong>{orgName}</strong> as a workspace you can switch to
                from the sidebar — your current workspace stays untouched.
              </p>
              <form action={acceptAsExistingUser}>
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                >
                  Accept invitation
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Sign up with <strong>{email}</strong> on the next screen
                and you&apos;ll be added to the team automatically.
              </p>
              <form action={startSignup}>
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                >
                  Continue to sign up
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function relativeFromNow(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "expired";
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) {
    const hours = Math.round(diffMs / (1000 * 60 * 60));
    return `in ${hours}h`;
  }
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}
