import { Suspense } from "react";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { GlobalSearch } from "@/components/global-search";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getAnnouncementsSummary } from "@/lib/services/announcements";
import { listMembershipsByUserId } from "@/lib/services/organizations";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { SidebarNavLinks } from "./sidebar-nav";
import { AppShell, SidebarCollapseButton } from "./app-shell";
import {
  NotificationsBell,
  NotificationsBellSkeleton,
} from "./notifications-bell";

/**
 * Authenticated app shell — Arc DNA gradient sidebar + open main column.
 *
 * Layout structure stays a Server Component; the AppShell client wrapper
 * owns the collapse state (so users can fold the sidebar away). The
 * sidebar contents (logo / search / workspace / nav / user card) are
 * passed as a `sidebarContent` slot so async server components inside
 * keep streaming via Suspense without becoming client.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell
      sidebarContent={<SidebarContent />}
      topRightContent={
        <Suspense fallback={<NotificationsBellSkeleton />}>
          <NotificationsBell />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}

function SidebarContent() {
  return (
    <>
      {/* Header row — the SaaS-standard pattern (Notion / Linear / Slack):
          workspace identity is the dominant top-left element, not the app
          name. Search and collapse icons sit on the same horizontal line
          to the right of the workspace switcher. The app brand "DueDateHQ"
          intentionally has no inline presence — once you're in the app,
          the workspace IS the identity that matters. */}
      <div className="flex items-center gap-1.5 pl-0 pr-2">
        <div className="min-w-0 flex-1">
          <Suspense fallback={<WorkspaceHeaderSkeleton />}>
            <SidebarWorkspaceSwitcher />
          </Suspense>
        </div>
        <GlobalSearch variant="icon" />
        <SidebarCollapseButton />
      </div>

      {/* Nav with badges */}
      <Suspense fallback={<NavSkeleton />}>
        <NavSection />
      </Suspense>

      {/* Footer: user card */}
      <div className="mt-auto px-1 pb-1">
        <Suspense fallback={<UserCardSkeleton />}>
          <SidebarUserCard />
        </Suspense>
      </div>
    </>
  );
}

async function SidebarWorkspaceSwitcher() {
  // Use getCurrentContext (cached per-request) instead of a separate
  // query so we don't pay the JOIN twice on every page load.
  const ctx = await getCurrentContext();
  const memberships = await listMembershipsByUserId(ctx.user.id);
  const options = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    role: m.membership.role,
  }));
  const current = options.find((o) => o.id === ctx.organization.id);
  if (!current) return null;
  return <WorkspaceSwitcher current={current} options={options} />;
}

function WorkspaceHeaderSkeleton() {
  return (
    <div className="flex items-center gap-2 px-1.5 py-0.5">
      <span className="h-7 w-7 rounded-lg bg-white/40 animate-pulse" />
      <div className="h-3 flex-1 rounded bg-white/40 animate-pulse" />
    </div>
  );
}

async function NavSection() {
  // Defense-in-depth: proxy.ts already protects, but verify in layout too.
  // Pass user id so dismissed announcements drop out of the badge count.
  const ctx = await getCurrentContext();
  const summary = await getAnnouncementsSummary(
    ctx.user.id,
    ctx.organization.id,
  );
  return <SidebarNavLinks taxUpdatesUnread={summary.highRelevance30d} />;
}

function NavSkeleton() {
  return (
    <div className="mt-2 space-y-1 px-2.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-8 rounded-xl bg-white/30 animate-pulse" />
      ))}
    </div>
  );
}

async function SidebarUserCard() {
  // Defense-in-depth: redirect to /sign-in if Clerk session disappeared
  // mid-flight (proxy.ts is the primary guard).
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const email = user.emailAddresses[0]?.emailAddress ?? "";
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-white/50 backdrop-blur">
      <UserButton appearance={{ elements: { avatarBox: "h-7 w-7" } }} />
      <span
        className="text-[12.5px] truncate"
        style={{ color: "var(--muted-foreground)" }}
        title={email}
      >
        {email}
      </span>
    </div>
  );
}

function UserCardSkeleton() {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-white/30">
      <span className="h-7 w-7 rounded-full bg-white/50 animate-pulse" />
      <span className="h-3 flex-1 rounded bg-white/50 animate-pulse" />
    </div>
  );
}
