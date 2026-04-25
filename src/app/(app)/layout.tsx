import { Suspense } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { GlobalSearch } from "@/components/global-search";
import { getAnnouncementsSummary } from "@/lib/services/announcements";

/**
 * Authenticated app shell. Static chrome + streamed auth-dependent slots.
 *
 * Cache Components pattern: the layout itself is static/streamable; anything
 * that touches runtime auth data lives inside <Suspense>.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Sticky, solid — nav must stay legible over long deadline tables */}
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link
              href="/dashboard"
              className="text-base font-semibold tracking-tight"
            >
              DueDateHQ
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <NavLink href="/dashboard" label="Dashboard" />
              <NavLink href="/clients" label="Clients" />
              <Suspense
                fallback={
                  <NavLink href="/announcements" label="IRS updates" />
                }
              >
                <UpdatesNavLink />
              </Suspense>
              <NavLink href="/settings" label="Settings" />
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <GlobalSearch />
            <Suspense fallback={<HeaderUserSkeleton />}>
              <HeaderUser />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

async function HeaderUser() {
  // Defense-in-depth: proxy.ts already protects, but verify in layout too.
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">
        {user.emailAddresses[0]?.emailAddress}
      </span>
      <UserButton />
    </div>
  );
}

function HeaderUserSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <span className="h-4 w-48 animate-pulse rounded bg-muted" />
      <span className="h-8 w-8 animate-pulse rounded-full bg-muted" />
    </div>
  );
}

function NavLink({
  href,
  label,
  badge,
}: {
  href: string;
  label: string;
  badge?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
    >
      {label}
      {badge}
    </Link>
  );
}

// Live unread-count badge for /announcements. Mirrors the dashboard
// banner threshold (score≥4 in last 7d) so the two surfaces agree on
// "what counts as worth your attention". Renders nothing when zero —
// no badge means no urgent IRS items, which is the default state.
async function UpdatesNavLink() {
  const summary = await getAnnouncementsSummary();
  const count = summary.highRelevance7d;
  const badge =
    count > 0 ? (
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-priority-urgent)] px-1 text-[10px] font-semibold text-white">
        {count > 9 ? "9+" : count}
      </span>
    ) : null;
  return <NavLink href="/announcements" label="IRS updates" badge={badge} />;
}
