/**
 * Deadline Report PDF — print-friendly document a CPA can:
 *   - Pin to their wall on Monday morning
 *   - Email to a client ("here's what's coming up for you")
 *   - Hand to a partner reviewing workload
 *
 * Layout: cover page with stats + overdue, then bucketed pages
 * (this-week, next-week, this-month, later). Auto-paginated by
 * @react-pdf/renderer when content overflows.
 *
 * No external assets — uses the bundled Helvetica font so it renders
 * identically locally and on Vercel without font fetches.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

// ---------------------------------------------------------------------------
// Types — kept narrow so the route handler can build them from a single SQL.
// ---------------------------------------------------------------------------

export type ReportDeadline = {
  id: string;
  effectiveDueDate: string; // ISO YYYY-MM-DD
  originalDueDate: string;
  /** ISO timestamp when filed; null = open. */
  completedAt: string | null;
  isExtended: boolean;
  formCode: string;
  ruleTitle: string;
  jurisdictionCode: string;
  irrevocable: boolean;
  clientName: string;
  entityName: string;
  entityType: string;
  homeState: string | null;
  notes: string | null;
};

export type ReportProps = {
  orgName: string;
  generatedAt: Date;
  asOf: Date;
  rangeDays: number;
  deadlines: ReportDeadline[];
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const COLOR = {
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  primary: "#1e40af",
  urgent: "#b91c1c",
  urgentBg: "#fef2f2",
  high: "#c2410c",
  done: "#15803d",
  bgMuted: "#f8fafc",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 60,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: COLOR.text,
    lineHeight: 1.4,
  },
  // ---- Header
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  brand: { fontSize: 9, color: COLOR.primary, fontFamily: "Helvetica-Bold" },
  generated: { fontSize: 8, color: COLOR.muted },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginTop: 6,
  },
  subtitle: {
    fontSize: 10,
    color: COLOR.muted,
    marginTop: 2,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: COLOR.border,
    marginVertical: 16,
  },

  // ---- Stat strip
  statRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  statCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLOR.border,
    borderRadius: 4,
    padding: 10,
  },
  statLabel: {
    fontSize: 8,
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
  },

  // ---- Section
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLOR.borderStrong,
  },
  sectionTitle: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  sectionCount: { fontSize: 9, color: COLOR.muted },

  // ---- Row
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.border,
  },
  rowOverdue: { backgroundColor: COLOR.urgentBg },
  cellDate: { width: 76, paddingRight: 6 },
  cellForm: { width: 60, paddingRight: 6 },
  cellMain: { flex: 1, paddingRight: 6 },
  cellMeta: { width: 110, alignItems: "flex-end" },

  cellDateValue: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  cellDateRel: { fontSize: 7.5, color: COLOR.muted, marginTop: 1 },
  cellFormCode: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  cellFormJur: { fontSize: 7.5, color: COLOR.muted, marginTop: 1 },
  cellClient: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  cellEntity: { fontSize: 8, color: COLOR.muted, marginTop: 1 },
  cellRule: { fontSize: 7.5, color: COLOR.muted, marginTop: 1 },
  cellMetaText: { fontSize: 8, color: COLOR.muted, textAlign: "right" },

  // ---- Inline badges
  badgeIrre: {
    backgroundColor: COLOR.urgent,
    color: "#ffffff",
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    marginLeft: 4,
  },
  badgeStatus: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },

  // ---- Empty state
  empty: {
    fontSize: 9,
    color: COLOR.muted,
    fontStyle: "italic",
    paddingVertical: 8,
  },

  // ---- Footer (every page)
  pageNumber: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: COLOR.muted,
  },
});

// ---------------------------------------------------------------------------
// Helpers (pure — keep the doc deterministic)
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function relDays(iso: string, asOf: Date): string {
  const due = new Date(iso + "T00:00:00");
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);
  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days}d`;
}

function entityLabel(t: string): string {
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
  return map[t] ?? t;
}

function jurisdictionLabel(code: string): string {
  return code === "federal" ? "US Federal" : code;
}

type Buckets = {
  overdue: ReportDeadline[];
  thisWeek: ReportDeadline[];
  next2Weeks: ReportDeadline[];
  thisMonth: ReportDeadline[];
  later: ReportDeadline[];
};

function bucketize(deadlines: ReportDeadline[], asOf: Date): Buckets {
  const today = new Date(asOf);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const buckets: Buckets = {
    overdue: [],
    thisWeek: [],
    next2Weeks: [],
    thisMonth: [],
    later: [],
  };

  for (const d of deadlines) {
    const due = new Date(d.effectiveDueDate + "T00:00:00").getTime();
    const days = Math.round((due - todayMs) / dayMs);
    if (days < 0) buckets.overdue.push(d);
    else if (days <= 7) buckets.thisWeek.push(d);
    else if (days <= 14) buckets.next2Weeks.push(d);
    else if (days <= 30) buckets.thisMonth.push(d);
    else buckets.later.push(d);
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatusBadge({
  isCompleted,
  isExtended,
}: {
  isCompleted: boolean;
  isExtended: boolean;
}) {
  if (isCompleted) {
    return (
      <Text style={[styles.badgeStatus, { color: COLOR.done }]}>FILED</Text>
    );
  }
  // Date-shifted flag is the only active-state badge after the status
  // collapse — partners doing morning review still want to spot the
  // "this got extended" signal at a glance. Pending = no badge.
  if (isExtended) {
    return (
      <Text style={[styles.badgeStatus, { color: COLOR.high }]}>EXT</Text>
    );
  }
  return null;
}

function Row({
  d,
  isOverdue,
  asOf,
}: {
  d: ReportDeadline;
  isOverdue: boolean;
  asOf: Date;
}) {
  const showEntity =
    d.entityName && d.entityName !== d.clientName ? d.entityName : null;

  return (
    <View
      style={isOverdue ? [styles.row, styles.rowOverdue] : styles.row}
      wrap={false}
    >
      <View style={styles.cellDate}>
        <Text style={styles.cellDateValue}>{fmtDate(d.effectiveDueDate)}</Text>
        <Text style={styles.cellDateRel}>{relDays(d.effectiveDueDate, asOf)}</Text>
      </View>
      <View style={styles.cellForm}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={styles.cellFormCode}>{d.formCode}</Text>
          {d.irrevocable ? (
            <Text style={styles.badgeIrre}>IRREV</Text>
          ) : null}
        </View>
        <Text style={styles.cellFormJur}>{jurisdictionLabel(d.jurisdictionCode)}</Text>
      </View>
      <View style={styles.cellMain}>
        <Text style={styles.cellClient}>{d.clientName}</Text>
        {showEntity ? (
          <Text style={styles.cellEntity}>
            {showEntity} · {entityLabel(d.entityType)}
          </Text>
        ) : (
          <Text style={styles.cellEntity}>{entityLabel(d.entityType)}</Text>
        )}
        <Text style={styles.cellRule}>{d.ruleTitle}</Text>
      </View>
      <View style={styles.cellMeta}>
        <StatusBadge
          isCompleted={d.completedAt !== null}
          isExtended={d.isExtended}
        />
      </View>
    </View>
  );
}

function Section({
  title,
  rows,
  asOf,
  emphasize = false,
}: {
  title: string;
  rows: ReportDeadline[];
  asOf: Date;
  emphasize?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text
          style={
            emphasize
              ? [styles.sectionTitle, { color: COLOR.urgent }]
              : styles.sectionTitle
          }
        >
          {title}
        </Text>
        <Text style={styles.sectionCount}>
          {rows.length} {rows.length === 1 ? "deadline" : "deadlines"}
        </Text>
      </View>
      {rows.map((d) => (
        <Row key={d.id} d={d} isOverdue={emphasize} asOf={asOf} />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main document
// ---------------------------------------------------------------------------

export function DeadlineReport({
  orgName,
  generatedAt,
  asOf,
  rangeDays,
  deadlines,
}: ReportProps) {
  const buckets = bucketize(deadlines, asOf);
  const irrevocableCount = deadlines.filter(
    (d) => d.irrevocable && d.completedAt === null,
  ).length;
  const filedCount = deadlines.filter((d) => d.completedAt !== null).length;

  const generatedStr = generatedAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Document
      title={`Deadlines — ${orgName}`}
      author={orgName}
      creator="DueDateHQ"
      producer="DueDateHQ"
    >
      <Page size="LETTER" style={styles.page}>
        {/* ---- Cover header */}
        <View style={styles.brandRow}>
          <Text style={styles.brand}>DueDateHQ</Text>
          <Text style={styles.generated}>Generated {generatedStr}</Text>
        </View>
        <Text style={styles.title}>Deadline Report</Text>
        <Text style={styles.subtitle}>
          {orgName} · next {rangeDays} days · {deadlines.length} total
        </Text>

        <View style={styles.divider} />

        {/* ---- Stats */}
        <View style={styles.statRow}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Overdue</Text>
            <Text
              style={
                buckets.overdue.length > 0
                  ? [styles.statValue, { color: COLOR.urgent }]
                  : styles.statValue
              }
            >
              {buckets.overdue.length}
            </Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>This week</Text>
            <Text style={styles.statValue}>{buckets.thisWeek.length}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Irrevocable open</Text>
            <Text
              style={
                irrevocableCount > 0
                  ? [styles.statValue, { color: COLOR.urgent }]
                  : styles.statValue
              }
            >
              {irrevocableCount}
            </Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>Filed</Text>
            <Text style={[styles.statValue, { color: COLOR.done }]}>
              {filedCount}
            </Text>
          </View>
        </View>

        {/* ---- Sections */}
        <Section
          title="Overdue — review first"
          rows={buckets.overdue}
          asOf={asOf}
          emphasize
        />
        <Section title="This week (next 7 days)" rows={buckets.thisWeek} asOf={asOf} />
        <Section title="Next week (8–14 days)" rows={buckets.next2Weeks} asOf={asOf} />
        <Section title="This month (15–30 days)" rows={buckets.thisMonth} asOf={asOf} />
        <Section title="Later (31+ days)" rows={buckets.later} asOf={asOf} />

        {deadlines.length === 0 ? (
          <Text style={styles.empty}>
            No upcoming deadlines in the selected range. Calm planning window.
          </Text>
        ) : null}

        {/* ---- Footer (page number) */}
        <View style={styles.pageNumber} fixed>
          <Text>{orgName} · DueDateHQ</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
