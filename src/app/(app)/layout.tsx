import { Suspense } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

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
      <header className="border-b border-border bg-background">
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
              <NavLink href="/settings" label="Settings" />
            </nav>
          </div>
          <Suspense fallback={<HeaderUserSkeleton />}>
            <HeaderUser />
          </Suspense>
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

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
    >
      {label}
    </Link>
  );
}
