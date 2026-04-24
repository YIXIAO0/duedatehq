/**
 * Client Calendar PDF — the document a CPA hands or emails to a client
 * once a year, usually with the engagement letter.
 *
 * Mental model: "Dear Sarah, here are YOUR tax deadlines for 2026."
 *
 * Three things make it different from the firm-wide PDF:
 *   1. The audience is the client (a non-CPA). Plain English, no
 *      "1120-S" jargon — that's a footnote, not the headline.
 *   2. It's chronological, not bucketed by urgency. The whole year laid
 *      out month by month so the client can plan around it.
 *   3. The CPA firm's name is the brand. DueDateHQ is footer-tiny.
 *
 * Status (filed / extended / pending) is intentionally NOT shown. This
 * is a forward-looking schedule — the CPA tracks status internally.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarEntity = {
  id: string;
  name: string;
  entityType: string;
  homeState: string | null;
};

export type CalendarDeadline = {
  id: string;
  entityId: string;
  dueDate: string; // ISO YYYY-MM-DD — original due date (forward-looking)
  formCode: string;
  ruleTitle: string;
  jurisdictionCode: string;
  irrevocable: boolean;
  penaltySummary: string | null;
};

export type ClientCalendarProps = {
  clientName: string;
  orgName: string;
  /** Email shown on the cover so the client knows who to reply to. */
  preparerEmail: string | null;
  /** Optional preparer display name (CPA's full name). */
  preparerName: string | null;
  taxYear: number;
  generatedAt: Date;
  entities: CalendarEntity[];
  deadlines: CalendarDeadline[];
};

// ---------------------------------------------------------------------------
// Plain-English form-code dictionary
//
// CPAs say "1120-S". Clients say "the business tax return". This map
// translates the most common federal forms; for state and unusual forms
// we fall back to the rule title (which is already human-ish).
// ---------------------------------------------------------------------------

const FORM_PLAIN_ENGLISH: Record<string, string> = {
  // Federal individual
  "1040": "Personal income tax return",
  "1040-ES": "Quarterly estimated tax payment",
  "4868": "Personal tax extension",

  // Federal business
  "1120": "C-Corporation tax return",
  "1120-S": "S-Corporation tax return",
  "1065": "Partnership tax return",
  "7004": "Business tax extension",

  // Trust / estate / nonprofit
  "1041": "Trust / estate tax return",
  "990": "Nonprofit tax return",
  "990-EZ": "Nonprofit tax return (small)",
  "990-N": "Nonprofit e-postcard",

  // Payroll & info returns
  "941": "Quarterly payroll tax return",
  "940": "Annual federal unemployment tax",
  "1099-NEC": "Contractor 1099 forms",
  "1099-MISC": "Miscellaneous 1099 forms",
  "W-2": "Employee W-2 forms",

  // International compliance
  FBAR: "Foreign bank account report",
  "8938": "Foreign financial assets report",
  "5500": "Retirement plan annual report",
};

function plainTitle(formCode: string, fallback: string): string {
  return FORM_PLAIN_ENGLISH[formCode] ?? fallback;
}

function entityTypeLabel(t: string): string {
  const map: Record<string, string> = {
    individual: "Individual",
    c_corp: "C-Corporation",
    s_corp: "S-Corporation",
    partnership: "Partnership",
    llc: "LLC",
    trust: "Trust",
    estate: "Estate",
    nonprofit: "Nonprofit",
  };
  return map[t] ?? t;
}

function jurisdictionLabel(code: string): string {
  return code === "federal" ? "Federal" : code;
}

function fmtMonth(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long" }).toUpperCase();
}

function fmtDayOfWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function fmtDayNum(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return String(d.getUTCDate());
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const COLOR = {
  text: "#0f172a",
  muted: "#64748b",
  faintBorder: "#e2e8f0",
  rule: "#cbd5e1",
  brand: "#1e40af",
  warn: "#b45309",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 64,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLOR.text,
    lineHeight: 1.5,
  },

  // Cover
  brandLine: {
    fontSize: 9,
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    fontFamily: "Helvetica-Bold",
  },
  orgName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: COLOR.brand,
    marginTop: 4,
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: COLOR.rule,
    marginTop: 12,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: COLOR.muted,
    marginBottom: 22,
  },
  intro: {
    fontSize: 10.5,
    lineHeight: 1.5,
    marginBottom: 22,
    color: COLOR.text,
  },

  // Entity section
  entityHeader: {
    marginTop: 18,
    paddingTop: 8,
    paddingBottom: 6,
    borderTopWidth: 2,
    borderTopColor: COLOR.text,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  entityName: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
  },
  entityKind: {
    fontSize: 9,
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  // Month band
  monthBand: {
    marginTop: 10,
    marginBottom: 4,
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: COLOR.brand,
    letterSpacing: 1.2,
  },

  // Deadline row — date column on the left, content on right
  deadlineRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.faintBorder,
  },
  dateCol: {
    width: 60,
    paddingRight: 12,
    alignItems: "flex-start",
  },
  dateNum: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.1,
  },
  dateDow: {
    fontSize: 8,
    color: COLOR.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 2,
  },
  contentCol: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 1,
  },
  taskMeta: {
    fontSize: 9,
    color: COLOR.muted,
  },
  irrevTag: {
    marginTop: 3,
    fontSize: 8.5,
    color: COLOR.warn,
    fontFamily: "Helvetica-Bold",
  },

  // Outro / footer
  outro: {
    marginTop: 28,
    padding: 14,
    backgroundColor: "#f8fafc",
    borderRadius: 4,
    fontSize: 10,
    color: COLOR.text,
    lineHeight: 1.5,
  },
  outroLabel: {
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  pageFooter: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: COLOR.muted,
  },
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

type GroupedDeadline = CalendarDeadline & { _month: string };

function groupForEntity(
  deadlines: CalendarDeadline[],
  entityId: string,
): Map<string, GroupedDeadline[]> {
  // Returns a Map<MonthLabel, deadlines[]> preserving chronological order.
  const filtered = deadlines
    .filter((d) => d.entityId === entityId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((d) => ({ ...d, _month: fmtMonth(d.dueDate) }));

  const out = new Map<string, GroupedDeadline[]>();
  for (const d of filtered) {
    const arr = out.get(d._month) ?? [];
    arr.push(d);
    out.set(d._month, arr);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function DeadlineRow({ d }: { d: CalendarDeadline }) {
  const title = plainTitle(d.formCode, d.ruleTitle);
  const jurisdiction = jurisdictionLabel(d.jurisdictionCode);
  const formCodeNote =
    title.toLowerCase() === d.ruleTitle.toLowerCase()
      ? `${jurisdiction} · ${d.ruleTitle}`
      : `${jurisdiction} · Form ${d.formCode}`;

  return (
    <View style={styles.deadlineRow} wrap={false}>
      <View style={styles.dateCol}>
        <Text style={styles.dateNum}>{fmtDayNum(d.dueDate)}</Text>
        <Text style={styles.dateDow}>{fmtDayOfWeek(d.dueDate)}</Text>
      </View>
      <View style={styles.contentCol}>
        <Text style={styles.taskTitle}>{title}</Text>
        <Text style={styles.taskMeta}>{formCodeNote}</Text>
        {d.irrevocable ? (
          <Text style={styles.irrevTag}>
            ⚠ This deadline cannot be extended — must be filed on time.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function EntitySection({
  entity,
  deadlines,
}: {
  entity: CalendarEntity;
  deadlines: CalendarDeadline[];
}) {
  const months = groupForEntity(deadlines, entity.id);
  if (months.size === 0) return null;

  return (
    <View>
      <View style={styles.entityHeader} wrap={false}>
        <Text style={styles.entityName}>{entity.name}</Text>
        <Text style={styles.entityKind}>
          {entityTypeLabel(entity.entityType)}
          {entity.homeState ? ` · ${entity.homeState}` : ""}
        </Text>
      </View>
      {Array.from(months.entries()).map(([month, rows]) => (
        <View key={month}>
          <Text style={styles.monthBand} wrap={false}>
            {month}
          </Text>
          {rows.map((d) => (
            <DeadlineRow key={d.id} d={d} />
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main document
// ---------------------------------------------------------------------------

export function ClientCalendar({
  clientName,
  orgName,
  preparerEmail,
  preparerName,
  taxYear,
  generatedAt,
  entities,
  deadlines,
}: ClientCalendarProps) {
  const generatedStr = generatedAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // If a client has multiple entities, show all of them — even ones with
  // zero deadlines. The empty section is a useful prompt to add rules.
  const entitiesWithDeadlines = entities.filter((e) =>
    deadlines.some((d) => d.entityId === e.id),
  );

  return (
    <Document
      title={`${clientName} — Tax Calendar ${taxYear}`}
      author={orgName}
      creator={orgName}
      producer="DueDateHQ"
    >
      <Page size="LETTER" style={styles.page}>
        {/* ---- Cover */}
        <Text style={styles.brandLine}>Prepared by</Text>
        <Text style={styles.orgName}>{orgName}</Text>
        <View style={styles.hr} />

        <Text style={styles.title}>Tax Calendar {taxYear}</Text>
        <Text style={styles.subtitle}>
          For {clientName} · Generated {generatedStr}
        </Text>

        <Text style={styles.intro}>
          Below is your tax calendar for {taxYear}. We handle the filings,
          but some items may need your input — documents to send us, a
          signature, or information we&apos;ll request as each one
          approaches. Please save this for your records.
        </Text>

        {/* ---- Entity sections */}
        {entitiesWithDeadlines.length === 0 ? (
          <Text style={styles.taskMeta}>
            No deadlines on file for {taxYear} yet. Your accountant will
            update this when filings are scheduled.
          </Text>
        ) : (
          entitiesWithDeadlines.map((entity) => (
            <EntitySection
              key={entity.id}
              entity={entity}
              deadlines={deadlines}
            />
          ))
        )}

        {/* ---- Outro */}
        {preparerEmail || preparerName ? (
          <View style={styles.outro} wrap={false}>
            <Text style={styles.outroLabel}>Questions?</Text>
            <Text>
              Reach out to{" "}
              {preparerName ? `${preparerName} at ` : ""}
              {preparerEmail ?? orgName}.
            </Text>
          </View>
        ) : null}

        {/* ---- Footer */}
        <View style={styles.pageFooter} fixed>
          <Text>
            {orgName} · Tax Calendar {taxYear} for {clientName}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
