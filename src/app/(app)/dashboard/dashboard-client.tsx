"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  X,
  CheckCircle2,
  Loader2,
  Plus,
  FileSpreadsheet,
} from "lucide-react";
import { bulkMarkCompleteAction } from "./actions";

export type DashboardDeadline = {
  id: string;
  due_date: string;
  effective_due_date: string;
  status: string;
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
};

type UrgencyFilter = "all" | "urgent" | "irrevocable";
type StatusFilter = "active" | "extended_only" | "all";

interface FilterState {
  urgency: UrgencyFilter;
  status: StatusFilter;
  state: string; // state code or "all"
  entityType: string; // entity_type or "all"
}

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = (d: number) => today.getTime() + d * 86400000;

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
      id: "this-week",
      label: "This week",
      description: "Due in the next 7 days",
      deadlines: [],
      urgency: "urgent",
      defaultCollapsed: false,
    },
    {
      id: "next-2-weeks",
      label: "Next 2 weeks",
      description: "8–14 days out",
      deadlines: [],
      urgency: "high",
      defaultCollapsed: false,
    },
    {
      id: "this-month",
      label: "This month",
      description: "15–30 days out",
      deadlines: [],
      urgency: "medium",
      defaultCollapsed: true,
    },
    {
      id: "later",
      label: "Later (31–60 days)",
      description: "Plan ahead",
      deadlines: [],
      urgency: "low",
      defaultCollapsed: true,
    },
  ];

  for (const d of deadlines) {
    const due = new Date(d.effective_due_date + "T00:00:00").getTime();
    if (due < today.getTime()) {
      buckets[0].deadlines.push(d);
    } else if (due <= ms(7)) {
      buckets[1].deadlines.push(d);
    } else if (due <= ms(14)) {
      buckets[2].deadlines.push(d);
    } else if (due <= ms(30)) {
      buckets[3].deadlines.push(d);
    } else {
      buckets[4].deadlines.push(d);
    }
  }

  // Sort each bucket by effective date; irrevocable first within same date
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

export function DashboardClient({
  deadlines,
}: {
  deadlines: DashboardDeadline[];
}) {
  const [filter, setFilter] = useState<FilterState>({
    urgency: "all",
    status: "active",
    state: "all",
    entityType: "all",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(["this-month", "later"]),
  );
  const [applying, startApplying] = useTransition();

  // Options for state / entity type dropdowns (derived from actual data)
  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deadlines) set.add(d.jurisdiction_code);
    return Array.from(set).sort();
  }, [deadlines]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of deadlines) set.add(d.entity_type);
    return Array.from(set).sort();
  }, [deadlines]);

  // Apply filters
  const filtered = useMemo(() => {
    return deadlines.filter((d) => {
      if (filter.urgency === "irrevocable" && !d.irrevocable) return false;
      if (filter.urgency === "urgent") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(d.effective_due_date + "T00:00:00").getTime();
        const daysUntil = Math.round(
          (due - today.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysUntil > 7) return false;
      }
      if (filter.status === "active" && d.status === "extended") {
        // "active" still shows extended since they have active next-filing date
      }
      if (filter.status === "extended_only" && d.status !== "extended") {
        return false;
      }
      if (filter.state !== "all" && d.jurisdiction_code !== filter.state) {
        return false;
      }
      if (filter.entityType !== "all" && d.entity_type !== filter.entityType) {
        return false;
      }
      return true;
    });
  }, [deadlines, filter]);

  const buckets = useMemo(() => bucketByTime(filtered), [filtered]);
  const nonEmptyBuckets = buckets.filter((b) => b.deadlines.length > 0);

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

  const filtersActive =
    filter.urgency !== "all" ||
    filter.status !== "active" ||
    filter.state !== "all" ||
    filter.entityType !== "all";

  const totalVisible = filtered.length;
  const totalAll = deadlines.length;

  // Empty state: 2-path welcome (Import vs Add one)
  if (totalAll === 0) {
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

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Filter:</span>

        <Select
          value={filter.urgency}
          onValueChange={(v) =>
            setFilter((f) => ({ ...f, urgency: v as UrgencyFilter }))
          }
        >
          <SelectTrigger className="h-7 w-[130px] bg-background text-xs">
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
          <SelectTrigger className="h-7 w-[130px] bg-background text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jurisdictions</SelectItem>
            {stateOptions.map((s) => (
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
          <SelectTrigger className="h-7 w-[140px] bg-background text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All entity types</SelectItem>
            {typeOptions.map((t) => (
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
          <SelectTrigger className="h-7 w-[130px] bg-background text-xs">
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
            onClick={() =>
              setFilter({
                urgency: "all",
                status: "active",
                state: "all",
                entityType: "all",
              })
            }
          >
            <X className="mr-1 h-3 w-3" /> Clear
          </Button>
        ) : null}

        <div className="ml-auto text-xs text-muted-foreground">
          {totalVisible} of {totalAll}
        </div>
      </div>

      {/* Empty-filtered state */}
      {nonEmptyBuckets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No deadlines match these filters.
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

        return (
          <div
            key={b.id}
            className={`rounded-lg border ${
              b.urgency === "urgent"
                ? "border-[var(--color-priority-urgent)]/40"
                : "border-border"
            } overflow-hidden bg-background`}
          >
            {/* Bucket header: div container (NOT button — checkbox is a
                button inside, nesting them is invalid HTML + hydration
                error). Checkbox + chevron toggle are two separate
                clickable zones. */}
            <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
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
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{b.label}</span>
                    <span
                      className={`text-xs ${
                        b.urgency === "urgent"
                          ? "text-[var(--color-priority-urgent)]"
                          : b.urgency === "high"
                          ? "text-[var(--color-priority-high)]"
                          : "text-muted-foreground"
                      }`}
                    >
                      {b.deadlines.length}{" "}
                      {b.deadlines.length === 1 ? "deadline" : "deadlines"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {b.description}
                  </p>
                </div>
              </button>
            </div>

            {isOpen ? (
              <div className="divide-y divide-border border-t border-border">
                {b.deadlines.map((d) => (
                  <DeadlineRow
                    key={d.id}
                    d={d}
                    selected={selected.has(d.id)}
                    onToggle={() => toggleOne(d.id)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Floating bulk-action bar */}
      {selected.size > 0 ? (
        <div className="sticky bottom-4 z-10 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-full border border-border bg-background px-5 py-2.5 shadow-lg">
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

function DeadlineRow({
  d,
  selected,
  onToggle,
}: {
  d: DashboardDeadline;
  selected: boolean;
  onToggle: () => void;
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

  return (
    <div
      className={`group flex items-center gap-3 px-4 py-3 transition-colors ${
        selected ? "bg-primary/5" : "hover:bg-muted/30"
      }`}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`Select ${d.rule_title} for ${d.client_name}`}
      />
      <Link
        href={`/deadlines/${d.id}`}
        className="flex min-w-0 flex-1 items-center gap-4"
      >
        <div className="w-20 shrink-0 text-sm">
          <div className="font-medium">
            {due.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </div>
          <div className={`text-xs ${urgencyColor}`}>{daysLabel}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{d.rule_title}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">{d.client_name}</span>
            <span>·</span>
            <span className="truncate">{d.entity_name}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {d.is_extended ? (
            <Badge variant="outline" className="text-xs">
              Extended
            </Badge>
          ) : null}
          {d.irrevocable ? (
            <Badge className="bg-[var(--color-priority-urgent-bg)] text-[var(--color-priority-urgent)] hover:bg-[var(--color-priority-urgent-bg)]">
              Irrevocable
            </Badge>
          ) : null}
          <Badge variant="outline" className="font-mono text-xs">
            {d.jurisdiction_code === "federal" ? "US" : d.jurisdiction_code}
          </Badge>
        </div>
      </Link>
    </div>
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
