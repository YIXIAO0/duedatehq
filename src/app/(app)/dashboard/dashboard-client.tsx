"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ChevronDown,
  ChevronRight,
  X,
  CheckCircle2,
  Loader2,
  Plus,
  FileSpreadsheet,
  Search,
  CalendarDays,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { bulkMarkCompleteAction } from "./actions";
import { assignDeadlineAction } from "../deadlines/[id]/actions";
import {
  MiniCalendar,
  type SidebarClient,
  type SmartView,
} from "./dashboard-sidebar";
import {
  paletteForClient,
  clientInitials,
} from "@/lib/utils/client-palette";

export type DashboardDeadline = {
  id: string;
  due_date: string;
  effective_due_date: string;
  /** ISO timestamp when filed; null = open. State (Pending / Filed /
      Overdue) is computed in the UI. */
  completed_at: string | null;
  tax_year: number;
  client_id: string;
  client_name: string;
  entity_id: string;
  entity_name: string;
  entity_type: string;
  rule_id: string;
  form_code: string;
  rule_title: string;
  jurisdiction_code: string;
  irrevocable: boolean;
  is_extended: boolean;
  /** Member responsible for this deadline. Null = unassigned. */
  owner_user_id: string | null;
  owner_full_name: string | null;
  owner_email: string | null;
  /**
   * Compact prep-stage progress summary. Populated server-side via
   * listProgressForDeadlines when the dashboard query runs. Absent (or
   * total=0) means the deadline has no stages yet — row hides the
   * progress strip entirely. Stages never appear in calendar/ICS so
   * this is purely an in-app hint of "where the prep work stands".
   */
  subtask_progress?: {
    total: number;
    done: number;
    next_label: string | null;
    next_due_date: string | null;
  };
};

type UrgencyFilter = "all" | "urgent" | "irrevocable";
type StatusFilter = "active" | "extended_only" | "all";

interface FilterState {
  urgency: UrgencyFilter;
  status: StatusFilter;
  state: string; // state code or "all"
  entityType: string; // entity_type or "all"
}

// Search lives outside FilterState — it's applied purely client-side over
// the already-loaded deadline set, so no debounce / no fetch / no SQL.
// Server-side dropdown filters still trigger a refetch via FilterState.

// ---------------------------------------------------------------------------
// Time bucketing
// ---------------------------------------------------------------------------

type Bucket = {
  id: string;
  label: string;
  description: string;
  deadlines: DashboardDeadline[];
  urgency: "urgent" | "high" | "medium" | "low";
  defaultCollapsed: boolean;
};

function bucketByTime(deadlines: DashboardDeadline[]): Bucket[] {
  // Anchor to local-midnight today so date-only comparisons stay clean.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Week boundary: Sunday-start week. End-of-this-week = upcoming Saturday.
  const dayOfWeek = today.getDay(); // Sun=0..Sat=6
  const endOfThisWeek = new Date(today);
  endOfThisWeek.setDate(endOfThisWeek.getDate() + (6 - dayOfWeek));
  const endOfNextWeek = new Date(endOfThisWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  // Month boundary: end-of-month is "last day at 00:00", inclusive.
  const endOfThisMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  );
  const endOfNextMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 2,
    0,
  );

  const monthName = today.toLocaleDateString("en-US", { month: "long" });
  const nextMonthName = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    1,
  ).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const dateRangeLabel = (from: Date, to: Date) => {
    const opts = { month: "short", day: "numeric" } as const;
    return `${from.toLocaleDateString("en-US", opts)} – ${to.toLocaleDateString("en-US", opts)}`;
  };

  const buckets: Bucket[] = [
    {
      id: "overdue",
      label: "Overdue",
      description: "Past the effective due date — triage first",
      deadlines: [],
      urgency: "urgent",
      defaultCollapsed: false,
    },
    {
      id: "today",
      label: "Today",
      description: today.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      deadlines: [],
      urgency: "urgent",
      defaultCollapsed: false,
    },
    {
      id: "tomorrow",
      label: "Tomorrow",
      description: tomorrow.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
      deadlines: [],
      urgency: "urgent",
      defaultCollapsed: false,
    },
    {
      id: "rest-of-week",
      label: "Rest of this week",
      description: dateRangeLabel(
        new Date(tomorrow.getTime() + 86400000),
        endOfThisWeek,
      ),
      deadlines: [],
      urgency: "high",
      defaultCollapsed: false,
    },
    {
      id: "next-week",
      label: "Next week",
      description: dateRangeLabel(
        new Date(endOfThisWeek.getTime() + 86400000),
        endOfNextWeek,
      ),
      deadlines: [],
      urgency: "high",
      defaultCollapsed: false,
    },
    {
      id: "later-this-month",
      label: `Later in ${monthName}`,
      description: dateRangeLabel(
        new Date(endOfNextWeek.getTime() + 86400000),
        endOfThisMonth,
      ),
      deadlines: [],
      urgency: "medium",
      defaultCollapsed: true,
    },
    {
      id: "next-month",
      label: nextMonthName,
      description: "Plan ahead",
      deadlines: [],
      urgency: "medium",
      defaultCollapsed: true,
    },
    {
      id: "beyond",
      label: "Beyond",
      description: "Further out",
      deadlines: [],
      urgency: "low",
      defaultCollapsed: true,
    },
  ];

  const tMs = today.getTime();
  for (const d of deadlines) {
    const due = new Date(d.effective_due_date + "T00:00:00").getTime();
    if (due < tMs) buckets[0].deadlines.push(d);
    else if (due === tMs) buckets[1].deadlines.push(d);
    else if (due === tomorrow.getTime()) buckets[2].deadlines.push(d);
    else if (due <= endOfThisWeek.getTime()) buckets[3].deadlines.push(d);
    else if (due <= endOfNextWeek.getTime()) buckets[4].deadlines.push(d);
    else if (due <= endOfThisMonth.getTime()) buckets[5].deadlines.push(d);
    else if (due <= endOfNextMonth.getTime()) buckets[6].deadlines.push(d);
    else buckets[7].deadlines.push(d);
  }

  for (const b of buckets) {
    b.deadlines.sort((a, b) => {
      if (a.effective_due_date !== b.effective_due_date) {
        return a.effective_due_date.localeCompare(b.effective_due_date);
      }
      return Number(b.irrevocable) - Number(a.irrevocable);
    });
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Client component
// ---------------------------------------------------------------------------

// Hardcoded filter options (from our seed data). If seed expands past
// these, the API still supports whatever state/type the user data has —
// this is just the dropdown labels.
const STATE_OPTIONS = ["federal", "CA", "NY", "TX", "DE", "NJ"];
const TYPE_OPTIONS = [
  "individual",
  "c_corp",
  "s_corp",
  "partnership",
  "llc",
  "trust",
  "estate",
  "nonprofit",
];
const PAGE_SIZE = 100;

export interface MemberSummary {
  userId: string;
  fullName: string | null;
  email: string;
}

/**
 * Owner-filter axis — orthogonal to SmartView (time/state). Controls
 * which subset of the loaded deadlines is visible based on assignment:
 *   - "all"        → every deadline regardless of owner (solo default)
 *   - "mine"       → only deadlines owned by the current user (multi-user default)
 *   - "unassigned" → only deadlines with owner_user_id = null
 */
type OwnerFilter = "all" | "mine" | "unassigned";

export function DashboardClient({
  initialDeadlines,
  initialHasMore,
  clients,
  currentUserId,
  members,
}: {
  initialDeadlines: DashboardDeadline[];
  initialHasMore: boolean;
  clients: SidebarClient[];
  currentUserId: string;
  members: MemberSummary[];
}) {
  const isMultiUser = members.length > 1;
  const [filter, setFilter] = useState<FilterState>({
    urgency: "all",
    status: "active",
    state: "all",
    entityType: "all",
  });
  // Default to "all" for everyone — first impression should be the
  // full open queue (HubSpot / Linear pattern). "Mine" / "Unassigned"
  // are opt-in narrows from the dropdown when the CPA wants to focus.
  // Defaulting to "Mine" was a bad call — multi-user orgs would land on
  // an empty list ("0 deadlines") because freshly-imported deadlines
  // start unassigned, and the user has no idea why.
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  // Search is purely client-side — applied via useMemo on `deadlines`
  // before bucketing. No debounce, no fetch, no SQL — feels instant
  // because every keystroke is a sync filter over a small array.
  const [searchInput, setSearchInput] = useState("");
  const [view, setView] = useState<SmartView>("all");
  // Selected date from the mini-cal. When set, overrides the smart-filter
  // view and narrows the agenda to deadlines on that exact day. Clearing
  // happens via clicking the same day again, clicking a smart filter,
  // or pressing the Clear chip above the agenda.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [deadlines, setDeadlines] = useState(initialDeadlines);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [fetching, setFetching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(["later-this-month", "next-month", "beyond"]),
  );
  // Per-client-group expansion. Default: empty Set = all multi-deadline
  // groups COLLAPSED. CPA opens groups they care about. Without this, a
  // client with 10 deadlines fully expanded buries everything else in the
  // bucket. Single-deadline clients render as flat rows and aren't
  // affected by this state.
  const [expandedClients, setExpandedClients] = useState<Set<string>>(
    new Set(),
  );
  const toggleClientExpanded = (clientId: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  };
  const [applying, startApplying] = useTransition();

  // When filter changes, refetch from server starting at offset 0.
  // Skip the initial mount — initialDeadlines is already correct.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    let cancelled = false;
    setFetching(true);
    setSelected(new Set()); // reset selection when filter changes
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: "0",
      urgency: filter.urgency,
      jurisdiction: filter.state,
      entityType: filter.entityType,
      status: filter.status,
    });
    fetch(`/api/deadlines/list?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDeadlines(data.rows ?? []);
        setHasMore(!!data.hasMore);
      })
      .catch((err) => {
        console.error("[dashboard] filter fetch failed", err);
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(deadlines.length),
        urgency: filter.urgency,
        jurisdiction: filter.state,
        entityType: filter.entityType,
        status: filter.status,
      });
      const res = await fetch(`/api/deadlines/list?${params}`);
      const data = await res.json();
      setDeadlines((prev) => [...prev, ...(data.rows ?? [])]);
      setHasMore(!!data.hasMore);
    } catch (err) {
      console.error("[dashboard] load more failed", err);
    } finally {
      setLoadingMore(false);
    }
  }

  // Client-side search narrow — case-insensitive substring against client
  // name, entity name, form code, and rule title. Runs on every keystroke
  // (no debounce) because it's a sync .filter() on an array of <500
  // objects, which React handles in <16ms. Beats the prior server-side
  // implementation (300ms debounce + DB round-trip + ILIKE table scan
  // = ~500ms-1s perceived latency).
  const filteredDeadlines = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    let result = deadlines;
    // Owner narrow first — typically the largest reduction.
    if (ownerFilter === "mine") {
      result = result.filter((d) => d.owner_user_id === currentUserId);
    } else if (ownerFilter === "unassigned") {
      result = result.filter((d) => d.owner_user_id === null);
    }
    // Search narrow second — runs over the smaller set.
    if (q) {
      result = result.filter(
        (d) =>
          d.client_name.toLowerCase().includes(q) ||
          d.entity_name.toLowerCase().includes(q) ||
          d.form_code.toLowerCase().includes(q) ||
          d.rule_title.toLowerCase().includes(q),
      );
    }
    return result;
  }, [deadlines, searchInput, ownerFilter, currentUserId]);

  const buckets = useMemo(
    () => bucketByTime(filteredDeadlines),
    [filteredDeadlines],
  );

  // Headline counts shown in the chips row, hero, and KPI cards. Built
  // from `deadlines` (the server-filtered loaded set), NOT from
  // `filteredDeadlines` — client-side search is meant to narrow what's
  // VISIBLE in the buckets below, not to mutate the headline portfolio
  // numbers. The user expects "3 due today" to stay 3 even after they
  // search for "pacific" to find one specific row.
  const counts = useMemo(() => {
    const totalBuckets = bucketByTime(deadlines);
    const overdue =
      totalBuckets.find((b) => b.id === "overdue")?.deadlines.length ?? 0;
    const today =
      totalBuckets.find((b) => b.id === "today")?.deadlines.length ?? 0;
    const tomorrow =
      totalBuckets.find((b) => b.id === "tomorrow")?.deadlines.length ?? 0;
    const restOfWeek =
      totalBuckets.find((b) => b.id === "rest-of-week")?.deadlines.length ?? 0;
    return {
      all: deadlines.length,
      today,
      thisWeek: today + tomorrow + restOfWeek,
      overdue,
    };
  }, [deadlines]);

  // Smart-filter view → which buckets to show + optional row-level filter.
  // Today/Overdue narrow to specific buckets; Waiting filters rows by status
  // across every bucket. "All" is the default and shows everything.
  // selectedDate (from mini-cal) trumps everything else: when set, only
  // deadlines on that exact date are shown.
  const viewedBuckets = useMemo(() => {
    if (selectedDate) {
      return buckets
        .map((b) => ({
          ...b,
          deadlines: b.deadlines.filter(
            (d) => d.effective_due_date === selectedDate,
          ),
        }))
        .filter((b) => b.deadlines.length > 0);
    }
    if (view === "all") {
      return buckets.filter((b) => b.deadlines.length > 0);
    }
    if (view === "today") {
      return buckets
        .filter((b) => b.id === "overdue" || b.id === "today")
        .filter((b) => b.deadlines.length > 0);
    }
    if (view === "overdue") {
      return buckets
        .filter((b) => b.id === "overdue")
        .filter((b) => b.deadlines.length > 0);
    }
    // view === "thisWeek" — fall through to here (default)
    return buckets
      .filter(
        (b) =>
          b.id === "overdue" ||
          b.id === "today" ||
          b.id === "tomorrow" ||
          b.id === "rest-of-week",
      )
      .filter((b) => b.deadlines.length > 0);
  }, [buckets, view, selectedDate]);

  const nonEmptyBuckets = viewedBuckets;

  // Selection helpers
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleBucket(bucket: Bucket, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of bucket.deadlines) {
        if (checked) next.add(d.id);
        else next.delete(d.id);
      }
      return next;
    });
  }
  function toggleCollapsed(bucketId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(bucketId)) next.delete(bucketId);
      else next.add(bucketId);
      return next;
    });
  }
  function toggleClientSelection(
    clientDeadlines: DashboardDeadline[],
    checked: boolean,
  ) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of clientDeadlines) {
        if (checked) next.add(d.id);
        else next.delete(d.id);
      }
      return next;
    });
  }

  const filtersActive =
    filter.urgency !== "all" ||
    filter.status !== "active" ||
    filter.state !== "all" ||
    filter.entityType !== "all" ||
    searchInput.trim() !== "";

  // Empty state: 2-path welcome (Import vs Add one).
  // Shown only when no filters active AND no data returned — otherwise
  // the "no match" state appears below the filter bar.
  if (deadlines.length === 0 && !filtersActive && !fetching) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Welcome to DueDateHQ</CardTitle>
          <CardDescription>
            Get set up in 2 minutes. Pick the path that fits:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <Link
              href="/clients/import"
              className="group flex flex-col rounded-lg border-2 border-primary/30 bg-primary/5 p-6 transition-all hover:border-primary hover:bg-primary/10"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">
                Import from spreadsheet
                <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                  Recommended
                </span>
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Bring in your existing client list from Excel, File In Time,
                ProConnect, or any CSV. AI maps the columns for you.
              </p>
              <p className="mt-auto pt-3 text-sm font-medium text-primary group-hover:underline">
                Start import →
              </p>
            </Link>
            <Link
              href="/clients/new"
              className="group flex flex-col rounded-lg border-2 border-border bg-card p-6 transition-all hover:border-slate-400 hover:bg-muted/30"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-md bg-muted text-foreground">
                <Plus className="h-5 w-5" />
              </div>
              <h3 className="font-semibold">Add one client manually</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Starting fresh or testing the tool? Add a single client, pick
                their entity type + states, see deadlines appear.
              </p>
              <p className="mt-auto pt-3 text-sm font-medium group-hover:underline">
                Add client →
              </p>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  // `clients` prop is reserved for the future outer-sidebar pinned-clients
  // list. The dashboard view itself no longer renders an inner sidebar.
  void clients;

  // Apply a smart-filter view, clearing any pinned-day selection. Every
  // chip / KPI card / quick-filter button funnels through this.
  const applyView = (v: SmartView) => {
    setView(v);
    setSelectedDate(null);
    setSelected(new Set());
  };

  // Toggle a calendar-day pin. Clicking the same day again clears.
  const toggleDateSelection = (date: string) => {
    setSelectedDate((prev) => (prev === date ? null : date));
    setView("all");
    setSelected(new Set());
  };

  return (
    <div className="space-y-7">
      {/* Chips row — date pill anchors the page; "today / this week / overdue"
          counts are duplicated by the KPI cards below, so we don't need
          them here too. "Clear filter" surfaces when a non-default view
          is active so the user has a one-click reset path. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <DatePill />
        {view !== "all" || selectedDate ? (
          <button
            type="button"
            onClick={() => applyView("all")}
            className="text-[12.5px] font-medium hover:underline cursor-pointer"
            style={{ color: "var(--muted-foreground)" }}
          >
            Clear filter
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {isMultiUser ? (
            <OwnerFilterDropdown
              value={ownerFilter}
              onChange={setOwnerFilter}
            />
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Show full month"
                className="w-9 h-9 rounded-full bg-card shadow-card flex items-center justify-center hover:shadow-md transition-shadow"
              >
                <CalendarDays className="h-4 w-4 text-foreground/70" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-[340px] p-3 rounded-2xl shadow-card"
            >
              <MiniCalendar
                deadlines={deadlines}
                selectedDate={selectedDate}
                onSelectDate={toggleDateSelection}
              />
            </PopoverContent>
          </Popover>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/clients/import">
              <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Import
            </Link>
          </Button>
          <Button asChild className="rounded-full">
            <Link href="/clients/new">
              <Plus className="mr-1.5 h-4 w-4" /> Add client
            </Link>
          </Button>
        </div>
      </div>

      {/* Hero — calm time-aware greeting only. */}
      <Hero />

      {/* 3 KPI gradient cards — Today / This week / This month. Click to
          filter the agenda below. The cards carry the urgency signal so
          the buckets can stay visually calm. */}
      <KPICards counts={counts} view={view} onApplyView={applyView} />

      {/* Main agenda column — full-width now that the inner sidebar is gone. */}
      <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Filter:</span>

        {/* Search narrows by client / entity / form code / rule title.
            Sits at the front of the filter bar so it's the obvious "narrow
            this list" entry point. Debounced 300ms in state — see useEffect
            on searchInput. The clear-X appears once the input has content. */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          {/* type="text" not "search" — Chromium/Safari add a native gray
              clear-X to type=search inputs, which collided with our custom
              X button below. text + our own X is the cleaner contract. */}
          <Input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search deadlines…"
            className="h-7 w-[220px] bg-background pl-7 pr-7 text-xs"
            aria-label="Search deadlines"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              className="absolute right-1 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        {/* size="sm" routes to data-[size=sm]:h-7 (28px) on the trigger,
            matching the Search Input's h-7. Plain h-7 className doesn't
            win against the data-attribute h-8 default — must go through
            the component API to get aligned heights. */}
        <Select
          value={filter.urgency}
          onValueChange={(v) =>
            setFilter((f) => ({ ...f, urgency: v as UrgencyFilter }))
          }
        >
          <SelectTrigger
            size="sm"
            className="w-[130px] cursor-pointer bg-background text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All urgency</SelectItem>
            <SelectItem value="urgent">Urgent (≤ 7d + overdue)</SelectItem>
            <SelectItem value="irrevocable">Irrevocable only</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filter.state}
          onValueChange={(v) => setFilter((f) => ({ ...f, state: v }))}
        >
          <SelectTrigger
            size="sm"
            className="w-[130px] cursor-pointer bg-background text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jurisdictions</SelectItem>
            {STATE_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "federal" ? "US Federal" : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.entityType}
          onValueChange={(v) => setFilter((f) => ({ ...f, entityType: v }))}
        >
          <SelectTrigger
            size="sm"
            className="w-[140px] cursor-pointer bg-background text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entity types</SelectItem>
            {TYPE_OPTIONS.map((t) => (
              <SelectItem key={t} value={t}>
                {entityTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.status}
          onValueChange={(v) =>
            setFilter((f) => ({ ...f, status: v as StatusFilter }))
          }
        >
          <SelectTrigger
            size="sm"
            className="w-[130px] cursor-pointer bg-background text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active (incl. extended)</SelectItem>
            <SelectItem value="extended_only">Extended only</SelectItem>
          </SelectContent>
        </Select>

        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setSearchInput("");
              setFilter({
                urgency: "all",
                status: "active",
                state: "all",
                entityType: "all",
              });
            }}
          >
            <X className="mr-1 h-3 w-3" /> Clear
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {fetching ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : (
            <span>
              {deadlines.length} loaded{hasMore ? "+" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Active date-filter chip — surfaces "we're showing only one day"
          so the empty state below doesn't look like a bug. Only renders
          when a mini-cal day is actually selected. */}
      {selectedDate ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-accent/60 px-3 py-2 text-sm">
          <span className="text-accent-foreground">
            Showing only{" "}
            <span className="font-semibold">
              {new Date(selectedDate + "T00:00:00").toLocaleDateString(
                "en-US",
                {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                },
              )}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setSelectedDate(null)}
            className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium text-accent-foreground hover:bg-primary/10"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        </div>
      ) : null}

      {/* Empty-filtered state */}
      {!fetching && nonEmptyBuckets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {selectedDate
                ? "No deadlines on the selected day."
                : "No deadlines match these filters."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Buckets */}
      {nonEmptyBuckets.map((b) => {
        const isOpen = !collapsed.has(b.id);
        const allInBucketSelected =
          b.deadlines.length > 0 &&
          b.deadlines.every((d) => selected.has(d.id));
        const someInBucketSelected = b.deadlines.some((d) => selected.has(d.id));

        // Arc DNA: gradient header strip per urgency (rose-peach for
        // urgent buckets, amber-peach for high, soft-blue for calm).
        // The colored card edge replaces the SF Lightning highlight band.
        const headerGradient =
          b.urgency === "urgent"
            ? "linear-gradient(90deg, #FFD0D0 0%, #FFE3D0 100%)"
            : b.urgency === "high"
              ? "linear-gradient(90deg, #FFEFC9 0%, #FFE3D0 100%)"
              : "linear-gradient(90deg, #D7E5F8 0%, #E0DAF6 100%)";
        const headerTextColor =
          b.urgency === "urgent"
            ? "#8A2B2B"
            : b.urgency === "high"
              ? "#8A6420"
              : "#3F4F87";

        return (
          <div
            key={b.id}
            className="rounded-3xl shadow-card overflow-hidden bg-card"
          >
            {/* Bucket header — gradient strip matching urgency. Two
                separate clickable zones (checkbox + chevron toggle) so
                Radix doesn't nest <button> inside <button>. */}
            <div
              className="flex items-center gap-3 px-6 py-3"
              style={{ background: headerGradient }}
            >
              <Checkbox
                checked={
                  allInBucketSelected
                    ? true
                    : someInBucketSelected
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(v) => toggleBucket(b, v === true)}
                aria-label={`Select all in ${b.label}`}
              />
              <button
                type="button"
                onClick={() => toggleCollapsed(b.id)}
                className="flex flex-1 cursor-pointer items-center gap-3 text-left"
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown
                    className="h-4 w-4"
                    style={{ color: headerTextColor, opacity: 0.7 }}
                  />
                ) : (
                  <ChevronRight
                    className="h-4 w-4"
                    style={{ color: headerTextColor, opacity: 0.7 }}
                  />
                )}
                <div className="flex flex-1 items-baseline gap-2.5 flex-wrap">
                  <span
                    className="text-[18px]"
                    style={{ color: headerTextColor, fontWeight: 700 }}
                  >
                    {b.label}
                  </span>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[11.5px] font-medium"
                    style={{
                      background: "rgba(255,255,255,.6)",
                      color: headerTextColor,
                    }}
                  >
                    {b.deadlines.length} {b.deadlines.length === 1 ? "deadline" : "deadlines"}
                  </span>
                  <span
                    className="text-[12px]"
                    style={{ color: headerTextColor, opacity: 0.75 }}
                  >
                    {b.description}
                  </span>
                </div>
              </button>
            </div>

            {isOpen ? (
              <div className="divide-y divide-border border-t border-border">
                {/* Render walk: a "date streak" is a run of consecutive
                    client-groups (multi OR flat) all sitting on one
                    effective_due_date. We emit a single DateSubheader
                    above the run, then strip the redundant inline date
                    from each multi-group inside it. Without this, a
                    bucket with 4 multi-groups + 1 flat all on May 15
                    would print "May 15" five times — once per
                    multi-group header plus once for the trailing
                    flat-row subheader. Now it prints once.

                    Single-deadline clients render as flat rows (not
                    nested in a group block), because for buckets like
                    "Today (18)" where every client has just one 941-Q1
                    due, wrapping each in a header + indented child
                    creates 36 visual rows for 18 deadlines — heavy
                    redundancy. Flat rows let the bucket scan fast.

                    A multi-group whose children span multiple dates
                    (rare — same client with deadlines on different
                    days inside one bucket) breaks any streak: it
                    renders standalone with its own inline shared-date
                    label disabled (sharedDate=null path). */}
                {(() => {
                  type RenderItem =
                    | { kind: "dateHeader"; date: string; count: number }
                    | { kind: "flat"; d: DashboardDeadline }
                    | {
                        kind: "multiGroup";
                        group: ReturnType<typeof groupByClient>[number];
                        hideInlineDate: boolean;
                      };

                  const groups = groupByClient(b.deadlines);

                  // The single date this group sits on, or null when
                  // its children span multiple dates (mixed multi-group).
                  const groupDate = (
                    g: ReturnType<typeof groupByClient>[number],
                  ): string | null => {
                    const first = g.deadlines[0].effective_due_date;
                    return g.deadlines.every(
                      (d) => d.effective_due_date === first,
                    )
                      ? first
                      : null;
                  };

                  const items: RenderItem[] = [];
                  let i = 0;
                  while (i < groups.length) {
                    const date = groupDate(groups[i]);
                    if (date === null) {
                      // Mixed-date multi-group — no streak, no header.
                      items.push({
                        kind: "multiGroup",
                        group: groups[i],
                        hideInlineDate: false,
                      });
                      i++;
                      continue;
                    }
                    // Walk forward through any neighbors on the same date.
                    let j = i;
                    let total = 0;
                    let hasFlat = false;
                    while (j < groups.length && groupDate(groups[j]) === date) {
                      total += groups[j].deadlines.length;
                      if (groups[j].deadlines.length === 1) hasFlat = true;
                      j++;
                    }
                    const runLen = j - i;

                    // Emit the header when:
                    //   - the run covers >1 client (consolidating repeated
                    //     dates is the whole point), OR
                    //   - the run has any flat row (flat rows hide their
                    //     own date column, so without a header the date
                    //     would be invisible).
                    // A single multi-group on its own date keeps its
                    // inline "May 15 · in 15d" — adding a header on top
                    // would just be redundant chrome.
                    const emitHeader = runLen > 1 || hasFlat;
                    if (emitHeader) {
                      items.push({ kind: "dateHeader", date, count: total });
                    }
                    for (let k = i; k < j; k++) {
                      const gk = groups[k];
                      if (gk.deadlines.length === 1) {
                        items.push({ kind: "flat", d: gk.deadlines[0] });
                      } else {
                        items.push({
                          kind: "multiGroup",
                          group: gk,
                          hideInlineDate: emitHeader,
                        });
                      }
                    }
                    i = j;
                  }

                  return items.map((item, idx) => {
                    if (item.kind === "dateHeader") {
                      return (
                        <DateSubheader
                          key={`d-${idx}-${item.date}`}
                          date={item.date}
                          count={item.count}
                        />
                      );
                    }
                    if (item.kind === "flat") {
                      const d = item.d;
                      return (
                        <DeadlineRow
                          key={d.id}
                          d={d}
                          selected={selected.has(d.id)}
                          onToggle={() => toggleOne(d.id)}
                          hideClientName={false}
                          hideDate
                          showOwner={isMultiUser}
                          members={members}
                        />
                      );
                    }
                    // multiGroup
                    const g = item.group;
                    const ids = g.deadlines.map((d) => d.id);
                    const allSelected = ids.every((id) => selected.has(id));
                    const someSelected = ids.some((id) => selected.has(id));
                    const hasIrrevocable = g.deadlines.some(
                      (d) => d.irrevocable,
                    );
                    // "All children share a date" hoists the date into
                    // the client header (state pairs like TX Franchise +
                    // TX Public Info Report both on May 15 — no need to
                    // repeat it per row).
                    //
                    // When `hideInlineDate` is true, an outer
                    // DateSubheader is already saying "May 15" above
                    // this multi-group. Showing it inline here too
                    // would print the same date twice in vertical
                    // sequence — exactly the bug we're fixing.
                    const firstDate = g.deadlines[0].effective_due_date;
                    const sharedDate = g.deadlines.every(
                      (d) => d.effective_due_date === firstDate,
                    )
                      ? firstDate
                      : null;
                    const showInlineDate =
                      sharedDate !== null && !item.hideInlineDate;
                    const isExpanded = expandedClients.has(g.clientId);
                    const groupPalette = paletteForClient(g.clientId);
                    return (
                      <div key={g.clientId}>
                        {/* Multi-group header — visually parallel with a
                            flat DeadlineRow: same px-6 py-3.5, same
                            avatar treatment, same title size. The
                            chevron between checkbox and avatar is the
                            ONLY visual signal that this row groups
                            multiple deadlines below. */}
                        <div className="flex items-center gap-4 px-6 py-3.5 hover:bg-muted/30 transition-colors">
                          <Checkbox
                            checked={
                              allSelected
                                ? true
                                : someSelected
                                ? "indeterminate"
                                : false
                            }
                            onCheckedChange={(v) =>
                              toggleClientSelection(g.deadlines, v === true)
                            }
                            aria-label={`Select all deadlines for ${g.clientName}`}
                          />
                          <button
                            type="button"
                            onClick={() => toggleClientExpanded(g.clientId)}
                            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                            aria-label={
                              isExpanded
                                ? `Collapse ${g.clientName}`
                                : `Expand ${g.clientName}`
                            }
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <div
                            aria-hidden
                            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold"
                            style={{
                              background: groupPalette.bg,
                              color: groupPalette.text,
                            }}
                            title={g.clientName}
                          >
                            {clientInitials(g.clientName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/clients/${g.clientId}`}
                              className="block truncate text-[14.5px] font-medium hover:underline"
                            >
                              {g.clientName}
                            </Link>
                            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                              <span>
                                {g.deadlines.length} deadlines
                              </span>
                              {showInlineDate && sharedDate ? (
                                <SharedDateInline date={sharedDate} />
                              ) : null}
                              {hasIrrevocable ? (
                                <span style={{ color: "var(--client-rose-text)" }}>
                                  · includes irrevocable
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        {isExpanded ? (
                          // ml-8 indents children 32px so child text starts
                          // at the same x as the parent client name (which
                          // sits past Checkbox+gap+Chevron+gap = 32px from
                          // the row's px-4 left). Border-l-2 then visually
                          // descends from under the parent's chevron column.
                          <div className="ml-8 border-l-2 border-primary/20">
                            {g.deadlines.map((d) => (
                              <DeadlineRow
                                key={d.id}
                                d={d}
                                selected={selected.has(d.id)}
                                onToggle={() => toggleOne(d.id)}
                                hideClientName={true}
                                hideDate={sharedDate !== null}
                                showOwner={isMultiUser}
                                members={members}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Load more */}
      {hasMore && !fetching ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </>
            ) : (
              <>Load more ({PAGE_SIZE} at a time)</>
            )}
          </Button>
        </div>
      ) : null}
      </div>{/* /main agenda column */}

      {/* Floating bulk-action bar */}
      {selected.size > 0 ? (
        <div className="sticky bottom-4 z-10 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-full border border-border bg-card px-5 py-2.5 shadow-lg">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={applying}
            >
              Clear
            </Button>
            <Button
              size="sm"
              disabled={applying}
              onClick={() =>
                startApplying(async () => {
                  await bulkMarkCompleteAction({
                    deadlineIds: Array.from(selected),
                  });
                  setSelected(new Set());
                })
              }
            >
              {applying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Marking…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Mark all as filed
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// "Wed · Apr 30" — short date label rendered in the chips row.
// Time-aware greeting. Most CPAs open the dashboard first thing in the
// morning (the persona was built around "before coffee"). Falls back to
// neutral wording outside business hours.
function dateLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * "Today" date display — Variant C (outlined pill, color dot accent).
 *
 * Cron / Notion Calendar pattern: subtle outline + white fill, a tiny
 * rose dot does the only chromatic work, weekday sits in muted small
 * caps next to the date. Color stays a garnish, not the meal.
 */
function DatePill() {
  const now = new Date();
  const weekday = now.toLocaleDateString("en-US", { weekday: "short" });
  const monthDay = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-card px-3.5 py-1.5 text-[13px] font-medium text-foreground">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: "var(--client-rose)" }}
        aria-hidden
      />
      <span className="text-muted-foreground uppercase text-[10.5px] tracking-[0.08em] font-semibold">
        {weekday}
      </span>
      <span>{monthDay}</span>
    </span>
  );
}

function timeAwareGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// OwnerFilterDropdown — quiet "show ▾" dropdown that lives in the
// utility group (next to calendar / Import / Add client). Default state
// is "All" — the dropdown only shows up at all in multi-user orgs.
//
// We deliberately kept this small and right-aligned: HubSpot / Linear
// pattern is "first impression = full list, narrow afterward". The old
// segmented toggle was too prominent for a tertiary filter and
// defaulting to Mine made the dashboard look empty on first load.
function OwnerFilterDropdown({
  value,
  onChange,
}: {
  value: OwnerFilter;
  onChange: (v: OwnerFilter) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as OwnerFilter)}>
      <SelectTrigger
        className="h-9 rounded-full border-0 bg-card shadow-card px-3.5 text-[12.5px] font-medium hover:shadow-md transition-shadow cursor-pointer"
        aria-label="Filter by deadline owner"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="all">All deadlines</SelectItem>
        <SelectItem value="mine">My deadlines</SelectItem>
        <SelectItem value="unassigned">Unassigned only</SelectItem>
      </SelectContent>
    </Select>
  );
}

// CountChip — display-only count pill. Used to be a clickable filter
// duplicating the KPI cards below; the dark-fill active state also
// fought with the calm pastel theme. Now it's a passive label —
// "here's a number you should know" — and the action surface is the
// KPI cards (Today / This week / All open).
function CountChip({
  label,
  tone,
}: {
  label: string;
  tone: "rose" | "amber";
}) {
  const palette =
    tone === "rose"
      ? { bg: "var(--client-rose-bg)", text: "var(--client-rose-text)" }
      : { bg: "var(--client-amber-bg)", text: "var(--client-amber-text)" };
  return (
    <span
      className="rounded-full px-3 py-1 text-[12.5px] font-medium"
      style={{ background: palette.bg, color: palette.text }}
    >
      {label}
    </span>
  );
}

// Hero — calm greeting only. The subtitle was redundant: chips and KPI
// cards already convey "what's urgent / what's the load". Voice stays
// short per design memory.
function Hero() {
  return (
    <h1
      className="text-[40px] leading-[1.05]"
      style={{ fontWeight: 600, letterSpacing: "-0.025em" }}
    >
      {timeAwareGreeting()}.
    </h1>
  );
}

// 3 gradient KPI cards — Today / This week / This month. Carries the
// urgency signal so the buckets can stay calm. Cards are clickable —
// each maps to the matching SmartView.
function KPICards({
  counts,
  view,
  onApplyView,
}: {
  counts: { today: number; thisWeek: number; overdue: number; all: number };
  view: SmartView;
  onApplyView: (v: SmartView) => void;
}) {
  // "This month" = total open across the loaded window. Not a true
  // calendar-month count — the dashboard windows 60 days ahead — but
  // it's the right approximation for "how full is the queue overall".
  const monthCount = counts.all;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <KPICard
        label="Today"
        value={counts.today}
        sub={
          counts.overdue > 0
            ? `${counts.overdue} overdue · clear first`
            : counts.today === 0
              ? "All clear"
              : "Two estimated · one surcharge"
        }
        gradient="linear-gradient(135deg, #FFD0D0 0%, #FFE3D0 100%)"
        textColor="#8A2B2B"
        active={view === "today"}
        onClick={() => onApplyView("today")}
      />
      <KPICard
        label="This week"
        value={counts.thisWeek}
        sub={`${counts.thisWeek} through Sunday`}
        gradient="linear-gradient(135deg, #FFEFC9 0%, #FFE3D0 100%)"
        textColor="#8A6420"
        active={view === "thisWeek"}
        onClick={() => onApplyView("thisWeek")}
      />
      <KPICard
        label="All open"
        value={monthCount}
        sub={`${monthCount} total in your book`}
        gradient="linear-gradient(135deg, #D7E5F8 0%, #E0DAF6 100%)"
        textColor="#3F4F87"
        active={view === "all"}
        onClick={() => onApplyView("all")}
      />
    </div>
  );
}

function KPICard({
  label,
  value,
  sub,
  gradient,
  textColor,
  active,
  onClick,
}: {
  label: string;
  value: number;
  sub: string;
  gradient: string;
  textColor: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-2xl p-5 text-left transition-transform hover:scale-[1.01] cursor-pointer",
        active ? "ring-2 ring-foreground/20 shadow-card" : "",
      ].join(" ")}
      style={{ background: gradient, color: textColor }}
    >
      <div
        className="text-[12px] uppercase tracking-wider"
        style={{ fontWeight: 600 }}
      >
        {label}
      </div>
      <div
        className="text-[44px] leading-none mt-3"
        style={{ fontWeight: 700 }}
      >
        {value}
      </div>
      <div className="text-[12px] mt-2 opacity-75">{sub}</div>
    </button>
  );
}

// Inline "May 15 · in 19d" rendered next to a multi-deadline-client
// header when every child of the group shares a date. Same urgency
// coloring as DateSubheader so the time-pressure signal carries.
function SharedDateInline({ date }: { date: string }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(date + "T00:00:00");
  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  const accent =
    days < 0 || days <= 3
      ? "text-[var(--color-priority-urgent)]"
      : days <= 14
      ? "text-[var(--color-priority-high)]"
      : days <= 30
      ? "text-[var(--color-priority-medium)]"
      : "text-muted-foreground";
  const relLabel =
    days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
      ? "Today"
      : days === 1
      ? "Tomorrow"
      : `in ${days}d`;
  // FIT-style: weekday appended after date. "Apr 15 Wed" lets the
  // CPA scan the dashboard and tell at a glance whether a deadline
  // is on a workday or hits the weekend.
  return (
    <>
      <span className="ml-2 font-medium text-foreground">
        {due.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
        {due.toLocaleDateString("en-US", { weekday: "short" })}
      </span>
      <span className={`ml-1 ${accent}`}>{relLabel}</span>
    </>
  );
}

// Date subheader rendered above a streak of flat rows sharing one
// effective due date. Carries the urgency color (overdue → red, ≤3d
// urgent, ≤14d high, etc.) so the eye still gets the time-pressure
// signal even though the rows themselves no longer repeat the date.
function DateSubheader({ date, count }: { date: string; count: number }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(date + "T00:00:00");
  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  const accent =
    days < 0 || days <= 3
      ? "text-[var(--color-priority-urgent)]"
      : days <= 14
      ? "text-[var(--color-priority-high)]"
      : days <= 30
      ? "text-[var(--color-priority-medium)]"
      : "text-muted-foreground";

  const relLabel =
    days < 0
      ? `${Math.abs(days)}d overdue`
      : days === 0
      ? "Today"
      : days === 1
      ? "Tomorrow"
      : `in ${days}d`;

  return (
    <div className="flex items-center gap-2 bg-muted/20 px-4 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-wider">
        {due.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}{" "}
        {due.toLocaleDateString("en-US", { weekday: "short" })}
      </span>
      <span className={`text-[11px] ${accent}`}>{relLabel}</span>
      <span className="ml-auto text-[11px] text-muted-foreground">
        {count} {count === 1 ? "deadline" : "deadlines"}
      </span>
    </div>
  );
}

// (StatusProgressBar removed 2026-05-01 along with the workflow status
// enum. With state collapsed to Pending / Filed, a 3-segment bar adds
// chrome without information — the row's status badge already says
// "Filed" / "Overdue" / nothing-for-pending.)

/**
 * Clickable owner cell — assigned avatar OR "+ in dashed circle" for
 * unassigned. Click opens an inline popover with the member list so
 * the CPA can assign / reassign without leaving the dashboard. The
 * detail page has a richer picker (with email and avatar preview);
 * this is the keep-flowing-through-the-list version.
 *
 * Stable per-user color slot via paletteForClient — owner colors stay
 * consistent across sessions regardless of which client they're on.
 */
function OwnerCell({
  deadline,
  members,
}: {
  deadline: DashboardDeadline;
  members: MemberSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function assign(userId: string | null) {
    if (userId === deadline.owner_user_id) {
      setOpen(false);
      return;
    }
    startTransition(() => assignDeadlineAction(deadline.id, userId));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label={
            deadline.owner_user_id
              ? `Owner: ${deadline.owner_full_name ?? deadline.owner_email}. Click to reassign.`
              : "Unassigned. Click to assign."
          }
          className="cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {deadline.owner_user_id ? (
            <AssignedAvatar deadline={deadline} />
          ) : (
            <UnassignedPlus />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 p-1"
        onClick={(e) => e.stopPropagation()}
      >
        <OwnerPickerList
          members={members}
          currentOwnerUserId={deadline.owner_user_id}
          onPick={assign}
        />
      </PopoverContent>
    </Popover>
  );
}

function AssignedAvatar({ deadline }: { deadline: DashboardDeadline }) {
  const palette = paletteForClient(deadline.owner_user_id ?? "");
  const display = deadline.owner_full_name ?? deadline.owner_email ?? "Owner";
  const initials = clientInitials(display);
  return (
    <span
      title={display}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{ background: palette.bg, color: palette.text }}
    >
      {initials}
    </span>
  );
}

function UnassignedPlus() {
  return (
    <span
      title="Unassigned — click to assign"
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      style={{ border: "1px dashed var(--border)" }}
    >
      <Plus className="h-3 w-3" />
    </span>
  );
}

function OwnerPickerList({
  members,
  currentOwnerUserId,
  onPick,
}: {
  members: MemberSummary[];
  currentOwnerUserId: string | null;
  onPick: (userId: string | null) => void;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => onPick(null)}
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5 cursor-pointer"
      >
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] text-muted-foreground"
          style={{ border: "1px dashed var(--border)" }}
        >
          ·
        </span>
        <span
          className={
            currentOwnerUserId === null
              ? "font-medium"
              : "text-muted-foreground"
          }
        >
          Unassigned
        </span>
      </button>
      <div className="my-1 border-t border-border" />
      {members.map((m) => {
        const palette = paletteForClient(m.userId);
        const display = m.fullName ?? m.email.split("@")[0];
        const isCurrent = m.userId === currentOwnerUserId;
        return (
          <button
            key={m.userId}
            type="button"
            onClick={() => onPick(m.userId)}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-foreground/5 cursor-pointer"
          >
            <span
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
              style={{ background: palette.bg, color: palette.text }}
            >
              {clientInitials(display)}
            </span>
            <span
              className={`truncate ${isCurrent ? "font-medium" : ""}`}
            >
              {display}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DeadlineRow({
  d,
  selected,
  onToggle,
  hideClientName = false,
  hideDate = false,
  showOwner = false,
  members,
}: {
  d: DashboardDeadline;
  selected: boolean;
  onToggle: () => void;
  /** Inside a client-group block, parent shows the client name once — don't repeat per row. */
  hideClientName?: boolean;
  /** Inside a date-subheader block (consecutive flat rows on same date),
      the subheader carries the date — don't repeat per row. */
  hideDate?: boolean;
  /** Whether to render the owner avatar chip. True only for multi-user
      orgs — solo workspaces hide owner entirely (everything is implicitly
      the user's). */
  showOwner?: boolean;
  /** Org members — driven into the inline assign popover. Empty when
      showOwner=false (solo orgs skip rendering the cell entirely). */
  members?: MemberSummary[];
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d.effective_due_date + "T00:00:00");
  const daysUntil = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  const urgency =
    daysUntil < 0
      ? "urgent"
      : daysUntil <= 3
      ? "urgent"
      : daysUntil <= 14
      ? "high"
      : daysUntil <= 30
      ? "medium"
      : "done";

  const urgencyColor = {
    urgent: "text-[var(--color-priority-urgent)]",
    high: "text-[var(--color-priority-high)]",
    medium: "text-[var(--color-priority-medium)]",
    done: "text-muted-foreground",
  }[urgency];

  const daysLabel =
    daysUntil < 0
      ? `${Math.abs(daysUntil)}d overdue`
      : daysUntil === 0
      ? "Today"
      : daysUntil === 1
      ? "Tomorrow"
      : `${daysUntil}d`;

  // Row layout: checkbox + (date column when not hidden) + client-color
  // avatar + status segments + form title block + pills. The avatar
  // anchors the row to its client visually — same color shows up in
  // calendar dots, sidebar pinned-clients, and chip tints.
  //
  // Click targets: form title and date column → /deadlines/[id]; client
  // name (when shown) → /clients/[id]. No nested <a> tags. The empty
  // space hover-tints but isn't clickable.
  const palette = paletteForClient(d.client_id);
  return (
    <div
      className={`flex items-center gap-4 px-6 py-3.5 text-[13px] transition-colors ${
        selected ? "bg-accent/40" : "hover:bg-muted/30"
      }`}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`Select ${d.rule_title} for ${d.client_name}`}
      />
      {hideDate ? (
        // Phantom chevron-width void — multi-group headers in the same
        // bucket render `[Checkbox] [chevron-w-5] [avatar]`. Without
        // this void, flat rows would have their avatar 24px to the
        // left of multi-group avatars (visible mis-alignment when the
        // bucket mixes both row types).
        <div aria-hidden className="w-5 shrink-0" />
      ) : (
        <Link
          href={`/deadlines/${d.id}`}
          className="w-16 shrink-0 cursor-pointer text-center"
          aria-label={`View ${d.rule_title}`}
        >
          <div className="text-[14px] font-semibold">
            {due.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
          <div
            className={`text-[10.5px] uppercase tracking-wide ${urgencyColor}`}
          >
            {daysLabel}
          </div>
        </Link>
      )}
      {hideClientName ? null : (
        <div
          aria-hidden
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold"
          style={{
            background: palette.bg,
            color: palette.text,
          }}
          title={d.client_name}
        >
          {clientInitials(d.client_name)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={`/deadlines/${d.id}`}
          className="block truncate text-[14.5px] font-medium hover:underline"
        >
          {d.rule_title}
        </Link>
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          {hideClientName ? (
            <span className="truncate">
              {d.entity_name && d.entity_name !== d.client_name
                ? d.entity_name
                : entityTypeLabel(d.entity_type)}
            </span>
          ) : (
            <>
              <Link
                href={`/clients/${d.client_id}`}
                className="truncate hover:text-foreground hover:underline"
              >
                {d.client_name}
              </Link>
              {d.entity_name && d.entity_name !== d.client_name ? (
                <>
                  <span>·</span>
                  <span className="truncate">{d.entity_name}</span>
                </>
              ) : null}
            </>
          )}
        </div>
        <SubtaskProgressStrip progress={d.subtask_progress} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {showOwner && members ? (
          <OwnerCell deadline={d} members={members} />
        ) : null}
        {d.is_extended ? (
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{
              background: "var(--client-violet-bg)",
              color: "var(--client-violet-text)",
            }}
          >
            Extended
          </span>
        ) : null}
        {d.irrevocable ? (
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
            style={{
              background: "var(--client-rose-bg)",
              color: "var(--client-rose-text)",
            }}
          >
            Irrevocable
          </span>
        ) : null}
        <span
          className="rounded-full px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide"
          style={{
            background: "var(--client-blue-bg)",
            color: "var(--client-blue-text)",
          }}
        >
          {d.jurisdiction_code === "federal" ? "FED" : d.jurisdiction_code}
        </span>
      </div>
    </div>
  );
}

// Group deadlines by client for the "client-centric" view. Clients with
// multiple deadlines in the same bucket get a shared header; single-deadline
// clients are rendered flat (no extra nesting for no reason).
function groupByClient(
  deadlines: DashboardDeadline[],
): Array<{
  clientId: string;
  clientName: string;
  deadlines: DashboardDeadline[];
}> {
  const map = new Map<
    string,
    { clientId: string; clientName: string; deadlines: DashboardDeadline[] }
  >();
  for (const d of deadlines) {
    const existing = map.get(d.client_id);
    if (existing) {
      existing.deadlines.push(d);
    } else {
      map.set(d.client_id, {
        clientId: d.client_id,
        clientName: d.client_name,
        deadlines: [d],
      });
    }
  }
  // Sort groups by earliest due within group (preserves bucket's sort order)
  return Array.from(map.values()).sort((a, b) =>
    a.deadlines[0].effective_due_date.localeCompare(
      b.deadlines[0].effective_due_date,
    ),
  );
}

function entityTypeLabel(type: string): string {
  const map: Record<string, string> = {
    individual: "Individual",
    c_corp: "C-Corp",
    s_corp: "S-Corp",
    partnership: "Partnership",
    llc: "LLC",
    trust: "Trust",
    estate: "Estate",
    nonprofit: "Nonprofit",
  };
  return map[type] ?? type;
}

/**
 * Compact prep-stage progress for the dashboard row. Two lines collapse
 * into one strip: a 60px progress bar + "N/M prep" + the next-up hint.
 * Hides itself entirely when there are no stages — most deadlines won't
 * have stages, and showing "0/0" would just be visual noise.
 */
function SubtaskProgressStrip({
  progress,
}: {
  progress: DashboardDeadline["subtask_progress"];
}) {
  if (!progress || progress.total === 0) return null;
  const pct = Math.round((progress.done / progress.total) * 100);
  return (
    <div className="mt-1 flex items-center gap-2 text-[11.5px] text-muted-foreground">
      <div
        className="h-1 w-16 shrink-0 rounded-full overflow-hidden"
        style={{ background: "var(--border)" }}
        aria-hidden
      >
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: "var(--color-priority-done)",
          }}
        />
      </div>
      <span className="shrink-0">
        {progress.done}/{progress.total} prep
      </span>
      {progress.next_label && progress.next_due_date ? (
        <>
          <span aria-hidden>·</span>
          <span className="truncate">
            next:{" "}
            <span className="text-foreground">
              {progress.next_label} {formatStageDate(progress.next_due_date)}
            </span>
          </span>
        </>
      ) : null}
    </div>
  );
}

function formatStageDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
