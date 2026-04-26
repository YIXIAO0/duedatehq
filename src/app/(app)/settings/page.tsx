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

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Profile, organization, and preferences.
        </p>
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
        <CardDescription>
          The name shown on exports, emails, and audit logs.
        </CardDescription>
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
          Managed by Clerk — change your email, password, or sign-in methods
          here.
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
          Default reminder lead times, working hours, email digest cadence.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          We&apos;ll open this up after we gather feedback from the first 20
          pilots. If there&apos;s a preference you&apos;re missing, email us.
        </p>
      </CardContent>
    </Card>
  );
}
