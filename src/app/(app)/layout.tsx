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
import { AppShell } from "./app-shell";

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
    <AppShell sidebarContent={<SidebarContent />}>{children}</AppShell>
  );
}

function SidebarContent() {
  return (
    <>
      {/* Logo + brand + utility icons (search · collapse). Search lives
          here as an icon button rather than a separate full-width pill —
          the old pill competed visually with active nav items below.
          `pr-9` reserves space for the absolute-positioned collapse
          button (lives in app-shell, anchored top-4 right-3). */}
      <div className="flex items-center gap-2 px-2 pr-9">
        <div className="w-7 h-7 rounded-xl bg-white/60 backdrop-blur flex items-center justify-center text-[12px] font-bold">
          D
        </div>
        <div className="font-semibold tracking-tight text-[15px]">DueDateHQ</div>
        <div className="ml-auto">
          <GlobalSearch variant="icon" />
        </div>
      </div>

      {/* Workspace switcher — only renders when the user has multiple
          orgs to switch between. Solo users don't need a row that looks
          like a nav item but does nothing. When multi-org becomes a
          real case, move this to the logo row (as a dropdown trigger
          replacing the static brand text) instead of sandwiching it
          between Search and Nav. */}
      <Suspense fallback={null}>
        <SidebarWorkspaceSwitcher />
      </Suspense>

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
  // Solo-org users: render nothing. The static "X's practice" label
  // confuses (looks like a nav item, but the only thing it can do is
  // show what you already know). Bring it back at the logo row when
  // multi-org becomes a real case.
  if (memberships.length <= 1) return null;
  const options = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    role: m.membership.role,
  }));
  const current = options.find((o) => o.id === ctx.organization.id);
  if (!current) return null;
  return (
    <div className="px-2 mt-2">
      <WorkspaceSwitcher current={current} options={options} />
    </div>
  );
}

async function NavSection() {
  // Defense-in-depth: proxy.ts already protects, but verify in layout too.
  // Pass user id so dismissed announcements drop out of the badge count.
  const ctx = await getCurrentContext();
  const summary = await getAnnouncementsSummary(ctx.user.id);
  return <SidebarNavLinks taxUpdatesUnread={summary.highRelevance7d} />;
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
