"use client";

import { useState } from "react";
import Link from "next/link";
import { Inbox, Star, Calendar, Flame, Plus } from "lucide-react";
import type { DashboardDeadline } from "./dashboard-client";

export type SidebarClient = {
  id: string;
  name: string;
  activeDeadlineCount: number;
};

export type SmartView = "all" | "today" | "thisWeek" | "overdue";

type Props = {
  clients: SidebarClient[];
  deadlines: DashboardDeadline[];
  view: SmartView;
  onViewChange: (v: SmartView) => void;
  /** Total counts for badge display — independent of any active filter so
      the smart-filter buttons always show the true portfolio numbers. */
  counts: {
    all: number;
    today: number;
    thisWeek: number;
    overdue: number;
    waiting: number;
  };
  /** YYYY-MM-DD of a day picked in the mini-cal, or null when no day is
      pinned. The parent uses this to narrow the agenda to that one day. */
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
};

export function DashboardSidebar({
  clients,
  deadlines,
  view,
  onViewChange,
  counts,
  selectedDate,
  onSelectDate,
}: Props) {
  return (
    <aside className="flex flex-col gap-4">
      <MiniCalendar
        deadlines={deadlines}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
      />
      <SmartFilters view={view} onViewChange={onViewChange} counts={counts} />
      <ClientsList clients={clients} />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mini calendar — current month, today highlighted, dots on busy days.
// Visual-only for v1: no month nav, no day-click filter (just signals
// where the pressure is). Wires to the agenda's data so dots stay in
// sync with what's actually loaded below.
// ---------------------------------------------------------------------------

export function MiniCalendar({
  deadlines,
  selectedDate,
  onSelectDate,
}: {
  deadlines: DashboardDeadline[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Currently-displayed month (year, monthIndex). Independent of `today` so
  // the user can browse March / June / etc. without losing the today anchor.
  // Anchored to the 1st of the month to avoid off-by-one when stepping from
  // a 31-day month into a 30-day one.
  const [viewMonth, setViewMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const isViewingTodayMonth =
    year === today.getFullYear() && month === today.getMonth();

  // Build set of YYYY-MM-DD strings that have at least one deadline.
  // Distinguish "any" vs "urgent" (today/overdue or ≤3d) for dot color.
  const urgentSet = new Set<string>();
  const dueSet = new Set<string>();
  const todayMs = today.getTime();
  for (const d of deadlines) {
    const dateStr = d.effective_due_date;
    dueSet.add(dateStr);
    const due = new Date(dateStr + "T00:00:00").getTime();
    const days = Math.round((due - todayMs) / 86_400_000);
    if (days <= 3) urgentSet.add(dateStr);
  }
  // When today itself is urgent (e.g. a 941-Q1 due today), we want the
  // entire cell to switch from "calm blue today" to "alarm-red today".
  // Today-ness is still obvious from the bold pill on the current date;
  // urgency is the harder signal and deserves the louder color.
  const todayIso = isoDate(today);
  const isTodayUrgent = urgentSet.has(todayIso);

  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // Sun=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  // Build a 6-row × 7-col grid (always 42 cells — keeps height stable).
  type Cell = {
    day: number;
    inMonth: boolean;
    iso: string;
  };
  const cells: Cell[] = [];

  // Leading days from previous month
  for (let i = startWeekday - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const d = new Date(year, month - 1, day);
    cells.push({ day, inMonth: false, iso: isoDate(d) });
  }
  // Current month
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    cells.push({ day, inMonth: true, iso: isoDate(d) });
  }
  // Trailing to fill 42
  let nextDay = 1;
  while (cells.length < 42) {
    const d = new Date(year, month + 1, nextDay);
    cells.push({ day: nextDay, inMonth: false, iso: isoDate(d) });
    nextDay++;
  }

  const monthName = firstOfMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month - 1, 1))}
          className="rounded-sm px-1.5 py-0.5 text-sm leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{monthName}</div>
          {!isViewingTodayMonth ? (
            <button
              type="button"
              onClick={() =>
                setViewMonth(
                  new Date(today.getFullYear(), today.getMonth(), 1),
                )
              }
              className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Jump to current month"
            >
              Today
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setViewMonth(new Date(year, month + 1, 1))}
          className="rounded-sm px-1.5 py-0.5 text-sm leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-px text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div
            key={i}
            className="py-1 text-[11px] font-bold text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map((c, i) => {
          const isToday = c.iso === isoDate(today);
          const isUrgent = urgentSet.has(c.iso);
          const hasDue = dueSet.has(c.iso);
          const isSelected = selectedDate === c.iso;

          // Out-of-month cells aren't interactive: the agenda only carries
          // current/future windowed data, so a click would yield an empty
          // result. Render as a plain dimmed div, no button affordance.
          if (!c.inMonth) {
            return (
              <div
                key={i}
                className="relative flex aspect-square items-center justify-center text-[12px] text-muted-foreground/40"
              >
                {c.day}
              </div>
            );
          }

          // Layered state styling, in priority order:
          //   1. today (urgent vs not) — the loudest signal, full red fill
          //   2. selected — user intent, accent fill + inset ring
          //   3. urgent — pale red fill so urgent days read at a glance
          //   4. has-due (non-urgent) — soft amber fill (the warm "notice"
          //      tint) so "this day has stuff" lands on the date itself
          //      rather than relying on a 4px dot underneath
          //   5. default — transparent, hover-only
          //
          // The dot below the digit was replaced by the cell fill: a
          // small black dot was hard to spot against a bold date number,
          // and the warm fill makes "has deadlines" obvious without
          // adding a second visual element.
          const fillClass = isToday
            ? isTodayUrgent
              ? "bg-[var(--color-priority-urgent)] font-bold text-white hover:bg-[var(--color-priority-urgent)]/90"
              : "bg-gradient-to-br from-[#FF7B7B] to-[#FF6B6B] font-bold text-white shadow-sm"
            : isSelected
            ? "bg-accent font-semibold text-accent-foreground"
            : isUrgent
            ? "bg-[var(--color-priority-urgent-bg)] font-medium text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]/80"
            : hasDue
            ? "bg-[var(--color-priority-medium-bg)] font-medium text-[var(--color-priority-medium)] hover:bg-[var(--color-priority-medium-bg)]/80"
            : "text-foreground hover:bg-muted";
          const ringClass = isSelected ? "ring-2 ring-inset ring-primary" : "";

          // Inner dot is now only a fallback for cases where the cell
          // fill is hijacked by a louder state (today / selected) but
          // the day still has deadlines worth noting. For plain due /
          // urgent days the fill itself is the signal.
          const showInnerDot =
            hasDue && (isToday || isSelected) && !(isToday && isTodayUrgent);
          const innerDotColor = isToday
            ? "bg-primary-foreground"
            : isUrgent
            ? "bg-[var(--color-priority-urgent)]"
            : "bg-[var(--color-priority-medium)]";

          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelectDate(c.iso)}
              aria-pressed={isSelected}
              aria-label={`${c.iso}${hasDue ? " — has deadlines" : ""}${isToday ? " — today" : ""}${isTodayUrgent && isToday ? " — urgent" : ""}`}
              className={`relative flex aspect-square items-center justify-center rounded-md text-[12px] transition-colors ${fillClass} ${ringClass}`}
            >
              {c.day}
              {showInnerDot ? (
                <span
                  className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${innerDotColor}`}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {/* Legend mirrors the cell-fill treatment: a small filled chip in
          the same color the calendar uses for that state, so the legend
          reads as "find this color on a day = that's what it means".
          today / selected are self-evident from their bolder treatment
          and don't need legend entries. */}
      <div className="mt-2 flex items-center gap-3 border-t border-border pt-2 text-[10.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-[var(--color-priority-medium-bg)] border border-[var(--color-priority-medium)]/30" />
          Due
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-[var(--color-priority-urgent-bg)] border border-[var(--color-priority-urgent)]/30" />
          Urgent
        </span>
      </div>
    </div>
  );
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Smart filter buttons — quick-views over the loaded deadlines.
// Counts come from the parent (already computed once), so the badges
// stay accurate regardless of which view is active.
// ---------------------------------------------------------------------------

function SmartFilters({
  view,
  onViewChange,
  counts,
}: {
  view: SmartView;
  onViewChange: (v: SmartView) => void;
  counts: Props["counts"];
}) {
  const items: Array<{
    id: SmartView;
    label: string;
    icon: React.ReactNode;
    count: number;
    countTone?: "muted" | "urgent" | "warn";
  }> = [
    {
      id: "all",
      label: "All open",
      icon: <Inbox className="h-4 w-4" />,
      count: counts.all,
    },
    {
      id: "today",
      label: "Today",
      icon: <Star className="h-4 w-4" />,
      count: counts.today,
      countTone: counts.today > 0 ? "urgent" : "muted",
    },
    {
      id: "thisWeek",
      label: "This week",
      icon: <Calendar className="h-4 w-4" />,
      count: counts.thisWeek,
      countTone: counts.thisWeek > 0 ? "warn" : "muted",
    },
    {
      id: "overdue",
      label: "Overdue",
      icon: <Flame className="h-4 w-4" />,
      count: counts.overdue,
      countTone: counts.overdue > 0 ? "urgent" : "muted",
    },
  ];

  return (
    <nav className="rounded-lg border border-border bg-card p-1.5">
      {items.map((item) => {
        const active = view === item.id;
        const toneClass =
          item.countTone === "urgent"
            ? "text-[var(--color-priority-urgent)]"
            : item.countTone === "warn"
            ? "text-[var(--color-priority-high)]"
            : "text-muted-foreground";
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onViewChange(item.id)}
            className={[
              "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                : "text-foreground hover:bg-muted",
            ].join(" ")}
            aria-pressed={active}
          >
            <span className="flex items-center gap-2">
              <span className={active ? "text-sidebar-accent-foreground" : "text-muted-foreground"}>
                {item.icon}
              </span>
              {item.label}
            </span>
            <span className={`font-mono text-xs ${active ? "text-sidebar-accent-foreground" : toneClass}`}>
              {item.count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Clients quick-list — top clients by open deadline count, click jumps to
// the client detail page. No filter wiring on the dashboard (we keep that
// scoped to the urgency / state filters); this list is a navigation aid.
// ---------------------------------------------------------------------------

function ClientsList({ clients }: { clients: SidebarClient[] }) {
  const top = clients.slice(0, 8);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
          Clients
        </span>
        <Link
          href="/clients/new"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Plus className="h-3 w-3" /> Add
        </Link>
      </div>
      <div className="rounded-lg border border-border bg-card p-1.5">
        {top.length === 0 ? (
          <div className="px-2 py-4 text-xs text-muted-foreground">
            No clients yet.{" "}
            <Link href="/clients/new" className="text-primary hover:underline">
              Add one
            </Link>
            .
          </div>
        ) : (
          top.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              <span className="truncate">{c.name}</span>
              <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
                {c.activeDeadlineCount}
              </span>
            </Link>
          ))
        )}
        {clients.length > top.length ? (
          <Link
            href="/clients"
            className="mt-1 block rounded-md px-2.5 py-1.5 text-center text-xs text-primary hover:bg-muted"
          >
            View all ({clients.length}) →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
