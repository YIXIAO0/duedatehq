"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Newspaper, Settings } from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/announcements", label: "Tax updates", icon: Newspaper },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Active-state aware nav for the gradient sidebar. Server-rendered ancestor
 * passes `taxUpdatesUnread` so the badge stays in sync with the dashboard
 * banner threshold (score≥4 in last 7d) without re-querying client-side.
 */
export function SidebarNavLinks({
  taxUpdatesUnread,
}: {
  taxUpdatesUnread: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="mt-6 space-y-0.5 text-[14px]">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        // Treat /clients/[id] etc. as still under /clients for highlighting.
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const showBadge =
          item.href === "/announcements" && taxUpdatesUnread > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              "flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl transition-colors",
              active
                ? "bg-white/70 backdrop-blur shadow-sm font-medium text-foreground"
                : "text-foreground/75 hover:bg-white/40",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
            {showBadge ? (
              <span
                className="ml-auto inline-flex items-center justify-center rounded-full px-1.5 text-[11px] font-medium"
                style={{
                  background: "var(--client-rose-bg)",
                  color: "var(--client-rose-text)",
                  minWidth: "1.25rem",
                  height: "1.25rem",
                }}
                aria-label={`${taxUpdatesUnread} new`}
              >
                {taxUpdatesUnread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
