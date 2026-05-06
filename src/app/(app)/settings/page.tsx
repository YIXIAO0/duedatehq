import { Suspense } from "react";
import { UserProfile } from "@clerk/nextjs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getIcalToken } from "@/lib/services/ical-tokens";
import { OrgSettingsForm } from "./org-settings-form";
import { DigestPreviewCard } from "./digest-preview-card";
import { CalendarSyncCard } from "./calendar-sync-card";
import { Badge } from "@/components/ui/badge";
import {
  listMembers,
  listPendingInvitations,
  buildInviteUrl,
} from "@/lib/services/team";
import { TeamCard, TeamHeaderAction } from "./team-card";

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <div className="space-y-8">
        <Suspense
          fallback={
            <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
          }
        >
          <OrgSettingsSection />
        </Suspense>

        <Suspense
          fallback={
            <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
          }
        >
          <TeamSection />
        </Suspense>

        <Suspense
          fallback={
            <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
          }
        >
          <DigestSection />
        </Suspense>

        <Suspense
          fallback={
            <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
          }
        >
          <CalendarSyncSection />
        </Suspense>

        <ProfileSection />

        <PreferencesSection />
      </div>
    </div>
  );
}

async function DigestSection() {
  const ctx = await getCurrentContext();
  return <DigestPreviewCard recipientEmail={ctx.email} />;
}

async function OrgSettingsSection() {
  const ctx = await getCurrentContext();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organization</CardTitle>
      </CardHeader>
      <CardContent>
        <OrgSettingsForm
          orgId={ctx.organization.id}
          orgName={ctx.organization.name}
          plan={ctx.organization.plan}
        />
      </CardContent>
    </Card>
  );
}

async function TeamSection() {
  const ctx = await getCurrentContext();
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const [members, pendingInvites] = await Promise.all([
    listMembers(ctx.organization.id),
    listPendingInvitations(ctx.organization.id),
  ]);

  const memberViews = members.map((m) => ({
    membershipId: m.membership.id,
    userId: m.user.id,
    email: m.user.email,
    fullName: m.user.fullName,
    role: m.membership.role,
    joinedAt: m.membership.createdAt.toISOString(),
    isCurrentUser: m.user.id === ctx.user.id,
  }));

  // Pull the viewer's role from the same `members` query — saves an
  // extra DB roundtrip vs querying the membership row separately.
  // Falls back to "member" if for some reason the current user isn't
  // in the result (shouldn't happen since getCurrentContext requires
  // membership in this org).
  const viewerRole =
    memberViews.find((m) => m.isCurrentUser)?.role ?? "member";

  const inviteViews = pendingInvites.map((inv) => ({
    invitationId: inv.id,
    email: inv.email,
    role: inv.role,
    inviteUrl: buildInviteUrl(inv.token, appUrl),
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">Team</CardTitle>
        <TeamHeaderAction appUrl={appUrl} viewerRole={viewerRole} />
      </CardHeader>
      <CardContent>
        <TeamCard
          members={memberViews}
          pendingInvites={inviteViews}
          appUrl={appUrl}
          viewerRole={viewerRole}
        />
      </CardContent>
    </Card>
  );
}

async function CalendarSyncSection() {
  const ctx = await getCurrentContext();
  const token = await getIcalToken({
    userId: ctx.user.id,
    orgId: ctx.organization.id,
  });
  // App URL is read server-side because the client component should not
  // hard-code it (preview deploys, custom domains). Falls back to the
  // request origin in dev.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Calendar sync</CardTitle>
        <CardDescription>
          Add deadlines to Google Calendar, Outlook, or Apple Calendar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CalendarSyncCard initialToken={token} appUrl={appUrl} />
      </CardContent>
    </Card>
  );
}

function ProfileSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>
          Email, password, sign-in methods.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-hidden rounded-md">
        <UserProfile
          routing="hash"
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "w-full border-none shadow-none",
            },
          }}
        />
      </CardContent>
    </Card>
  );
}

function PreferencesSection() {
  return (
    <Card className="opacity-70">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Preferences
          <Badge variant="outline" className="text-xs">
            Coming soon
          </Badge>
        </CardTitle>
        <CardDescription>
          Reminder lead times, working hours, digest cadence.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
