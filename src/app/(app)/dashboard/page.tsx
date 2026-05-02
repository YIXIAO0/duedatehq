import Link from "next/link";
import { Suspense } from "react";
import { getCurrentContext } from "@/lib/auth/current-org";
import { listDashboardDeadlines } from "@/lib/services/deadline-engine";
import { listClientsWithEntityCount } from "@/lib/services/clients";
import { listAnnouncementsWithImpact } from "@/lib/services/announcements";
import { listMembers } from "@/lib/services/team";
import { listProgressForDeadlines } from "@/lib/services/subtasks";
import {
  DashboardClient,
  type DashboardDeadline,
} from "./dashboard-client";

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-8 py-8">
      {/* Page-level Import / Add-client buttons live inside the chips row
          rendered by DashboardClient now — the chrome stays together. */}
      <Suspense fallback={null}>
        <DashboardAnnouncements />
      </Suspense>

      <Suspense fallback={<DeadlinesSkeleton />}>
        <UpcomingDeadlines />
      </Suspense>
    </div>
  );
}

// Single-line "you have N IRS updates affecting your clients" strip
// at the top of the dashboard. Deliberately calm — slate-blue tone,
// not the previous red. Announcements aren't urgent ("call 911")
// events; they're informational ("FYI, here are some changes that
// touch your book"). The deadline list below it remains the focal
// point of the dashboard.
//
// Click → /announcements where the CPA can drill into specifics,
// review per-client, mark applied, etc. We deliberately don't
// surface the per-announcement cards / summaries / dismiss buttons
// inline here — that page is where the actual work happens.
async function DashboardAnnouncements() {
  // Mark this Suspense boundary as dynamic before listAnnouncementsWithImpact
  // hits `new Date()`. Cache Components requires this read of auth /
  // request data first.
  const ctx = await getCurrentContext();
  const allItems = await listAnnouncementsWithImpact(ctx.organization.id, {
    sinceDays: 30,
    minScore: 4,
    limit: 20,
    userId: ctx.user.id,
  });

  // Same gating as before: only count items where we have specific
  // affected clients AND not every client is already reviewed. The
  // strip should mean "there's actual review work waiting".
  const pending = allItems.filter((a) => {
    if (a.affectedClients.length === 0) return false;
    return a.ackedClientCount < a.affectedClients.length;
  });
  if (pending.length === 0) return null;

  // How many distinct clients across all unreviewed announcements
  // still need attention? More useful than "3 announcements" — the
  // CPA cares about people, not press releases.
  const pendingClientIds = new Set<string>();
  for (const a of pending) {
    const acked = new Set<string>(); // we don't track per-client ack here, so approximate
    void acked;
    // acked set isn't surfaced on the listing query; fall back to "any client
    // in an unreviewed announcement is potentially pending". Slight over-count
    // is fine for the headline strip — exact numbers live on /announcements.
    for (const c of a.affectedClients) pendingClientIds.add(c.id);
  }

  const announcementWord = pending.length === 1 ? "update" : "updates";
  const clientPhrase =
    pendingClientIds.size === 1
      ? "1 client"
      : `${pendingClientIds.size} clients`;

  return (
    <Link
      href="/announcements"
      className="mb-6 flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-card transition-colors hover:bg-muted/30"
    >
      <span
        className="w-7 h-7 rounded-xl flex items-center justify-center text-white text-[14px]"
        style={{
          background: "linear-gradient(135deg, #FF7B7B, #FFB85C)",
        }}
      >
        ⚑
      </span>
      <span className="flex-1 text-[14px]">
        <span className="font-semibold text-foreground">
          {pending.length} tax {announcementWord}
        </span>
        <span className="ml-1 text-muted-foreground">
          may affect {clientPhrase} on your list.
        </span>
      </span>
      <span
        className="text-[13px] font-medium"
        style={{ color: "var(--client-rose)" }}
      >
        Review →
      </span>
    </Link>
  );
}

async function UpcomingDeadlines() {
  const ctx = await getCurrentContext();
  // Parallelize: deadlines (for the agenda) and clients (for the sidebar
  // quick-list). Both keyed off the same org so they stream together.
  const [rows, clients, members] = await Promise.all([
    listDashboardDeadlines({
      orgId: ctx.organization.id,
      daysAhead: 60,
      limit: 100,
      offset: 0,
    }),
    listClientsWithEntityCount({
      orgId: ctx.organization.id,
      limit: 50,
      offset: 0,
      includeArchived: false,
    }),
    // Org members — drives the owner-filter ("Mine" vs everyone) and the
    // owner picker on the deadline detail page. Solo orgs (1 member)
    // skip the filter chrome entirely; multi-member orgs default to the
    // current user's view.
    listMembers(ctx.organization.id),
  ]);
  const hasMore = rows.length === 100;
  // Order clients by open-deadline count desc so the busiest names sit
  // at the top of the sidebar — the CPA's working set, not just the
  // most recently added.
  const sortedClients = clients
    .slice()
    .sort((a, b) => b.activeDeadlineCount - a.activeDeadlineCount)
    .map((c) => ({
      id: c.id,
      name: c.name,
      activeDeadlineCount: c.activeDeadlineCount,
    }));
  const memberSummaries = members.map((m) => ({
    userId: m.user.id,
    fullName: m.user.fullName,
    email: m.user.email,
  }));

  // Subtask progress per row — single bulk query keyed by deadline id.
  // Most deadlines won't have stages yet (this feature just shipped),
  // so the map will be small; the row component hides the strip when
  // total=0 to avoid empty-progress noise.
  const progressMap = await listProgressForDeadlines(
    rows.map((r) => r.id),
    ctx.organization.id,
  );
  const rowsWithProgress = (rows as unknown as DashboardDeadline[]).map((r) => {
    const p = progressMap.get(r.id);
    if (!p) return r;
    return {
      ...r,
      subtask_progress: {
        total: p.total,
        done: p.done,
        next_label: p.nextOpen?.label ?? null,
        next_due_date: p.nextOpen?.dueDate ?? null,
      },
    };
  });

  return (
    <DashboardClient
      initialDeadlines={rowsWithProgress}
      initialHasMore={hasMore}
      clients={sortedClients}
      currentUserId={ctx.user.id}
      members={memberSummaries}
    />
  );
}

function DeadlinesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-12 animate-pulse rounded-full bg-muted/40" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted/40" />
      <div className="grid grid-cols-3 gap-4">
        <div className="h-32 animate-pulse rounded-2xl bg-muted/40" />
        <div className="h-32 animate-pulse rounded-2xl bg-muted/40" />
        <div className="h-32 animate-pulse rounded-2xl bg-muted/40" />
      </div>
      <div className="h-[480px] animate-pulse rounded-3xl bg-muted/40" />
    </div>
  );
}
