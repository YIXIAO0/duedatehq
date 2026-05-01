"use client";

import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeft } from "lucide-react";

const STORAGE_KEY = "ddhq-sidebar-collapsed";

/**
 * Client wrapper that owns the sidebar collapse state. The actual
 * sidebar content (server components: logo / search / workspace
 * switcher / nav / user card) is passed in via the `sidebarContent`
 * slot — this is the standard pattern for embedding async server
 * components inside a "use client" boundary without making them client.
 *
 * State persists to localStorage so the sidebar stays where the CPA
 * left it across reloads. The first paint always renders the sidebar
 * open (we can't read localStorage during SSR). After hydration, if
 * the stored value says "collapsed", we switch — a ~50ms flash on
 * cold load that's preferable to either (a) blocking SSR for the
 * sidebar or (b) shipping a blocking inline script.
 */
export function AppShell({
  sidebarContent,
  children,
}: {
  sidebarContent: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "1") setCollapsed(true);
    setHydrated(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // localStorage may be unavailable (private mode); behavior
        // still works for the session.
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={[
          "hidden md:flex shrink-0 sticky top-0 h-screen flex-col overflow-hidden",
          // Skip the transition on first paint so users who reload
          // with a collapsed sidebar don't see it slide in from open.
          hydrated ? "transition-[width,border-color] duration-200" : "",
          collapsed ? "w-0 border-r-0" : "w-60 border-r border-border",
        ].join(" ")}
        style={{
          background:
            "linear-gradient(180deg, #FFD8D8 0%, #FFE8C7 35%, #D8E9FF 70%, #E5DFFF 100%)",
        }}
        aria-hidden={collapsed}
      >
        {/* Inner wrapper holds a fixed 240px so contents don't reflow
            while the outer aside animates from 240→0. */}
        <div className="relative flex w-60 flex-1 flex-col px-3 py-4 min-h-0">
          <button
            type="button"
            onClick={toggle}
            className="absolute top-4 right-3 w-7 h-7 rounded-full bg-white/50 hover:bg-white flex items-center justify-center text-foreground/70 transition-colors"
            aria-label="Collapse sidebar"
            tabIndex={collapsed ? -1 : 0}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
          {sidebarContent}
        </div>
      </aside>

      <main className="flex-1 min-w-0 relative">
        {/* Expand toggle — only visible when sidebar is collapsed.
            Sits in the dashboard's top padding area (left side). */}
        {collapsed ? (
          <button
            type="button"
            onClick={toggle}
            className="hidden md:flex absolute top-4 left-4 z-30 w-8 h-8 rounded-full bg-card shadow-card items-center justify-center hover:shadow-md text-foreground/70 transition-shadow"
            aria-label="Expand sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        ) : null}
        {children}
      </main>
    </div>
  );
}
