/**
 * Daily reminder pipeline (C-3) — fires at 06:00 UTC every day.
 *
 * Three deadline tiers (T-7 / T-3 / T-1) + one stage tier (T-1):
 *
 *   deadline_t_minus_{7,3,1}  → notify deadline.owner_user_id when
 *                                effective_due_date == today + N days
 *   stage_t_minus_1           → notify subtask.owner_user_id ?? deadline.owner
 *                                when subtask.due_date == today + 1 day
 *
 * Each fire writes:
 *   - one row to `notifications` (per-recipient popover feed)
 *   - one email to the recipient via Resend
 *
 * Idempotency lives entirely on the `notifications` table — its
 *   UNIQUE NULLS NOT DISTINCT (user_id, deadline_instance_id, subtask_id, kind)
 * constraint is the source of truth for "did we already fire this combo?".
 * INSERT ... ON CONFLICT DO NOTHING RETURNING id; if RETURNING is empty,
 * we silently skip — including the email send. This keeps the in-app feed
 * and email inbox in lockstep.
 *
 * NOT writing to `reminders_sent` for now. That table's existing unique
 * (deadline_id, days_before_due, channel) collides between deadline_T-1
 * and stage_T-1 for the same deadline (both have days_before=1). The right
 * fix is to add subtask_id to that schema, but it's out of scope for v1
 * since `notifications` already covers idempotency for both tiers.
 *
 * Email failure tolerance: if Resend rejects after we've already inserted
 * the notification row, the user gets the in-app reminder but no email.
 * Acceptable degraded mode — we log loudly and the next cron run won't
 * retry (notifications row is the lock). A retry queue can be layered on
 * top later without touching this pipeline.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { Resend } from "resend";
import { getDb } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { recordAudit } from "./audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReminderKind =
  | "deadline_t_minus_7"
  | "deadline_t_minus_3"
  | "deadline_t_minus_1"
  | "stage_t_minus_1";

type ReminderCandidate = {
  kind: ReminderKind;
  // Recipient (resolved owner — fallback applied for stages with NULL owner)
  userId: string;
  userEmail: string;
  userFullName: string | null;
  orgId: string;
  orgName: string;
  // Parent deadline (always present)
  deadlineInstanceId: string;
  ruleTitle: string;
  formCode: string;
  jurisdictionCode: string;
  effectiveDueDate: string; // ISO date "YYYY-MM-DD"
  irrevocable: boolean;
  entityName: string;
  clientId: string;
  clientName: string;
  // Stage-only fields (NULL for deadline tiers)
  subtaskId: string | null;
  subtaskLabel: string | null;
  subtaskDueDate: string | null;
};

type DispatchOutcome = "sent" | "skipped" | "failed";

export type DispatchRemindersResult = {
  asOfIso: string;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  byKind: Record<
    ReminderKind,
    { attempted: number; sent: number; skipped: number; failed: number }
  >;
  errors: Array<{
    kind: ReminderKind;
    deadlineInstanceId: string;
    subtaskId: string | null;
    userId: string;
    error: string;
  }>;
};

// ---------------------------------------------------------------------------
// Date helpers — UTC-anchored, dateOnly-safe
// ---------------------------------------------------------------------------

/** Today in UTC, formatted as "YYYY-MM-DD". Cron runs at 06:00 UTC daily. */
function todayUtcIso(asOf: Date): string {
  return asOf.toISOString().slice(0, 10);
}

/** asOf + N days, "YYYY-MM-DD". Pure date arithmetic, no DST drama. */
function addDaysIso(asOf: Date, days: number): string {
  const d = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Candidate queries — one per tier cluster (deadline / stage)
// ---------------------------------------------------------------------------

async function findDeadlineCandidates(
  asOf: Date,
  daysBefore: 7 | 3 | 1,
): Promise<ReminderCandidate[]> {
  const db = getDb();
  const target = addDaysIso(asOf, daysBefore);
  const kind: ReminderKind =
    daysBefore === 7
      ? "deadline_t_minus_7"
      : daysBefore === 3
        ? "deadline_t_minus_3"
        : "deadline_t_minus_1";

  // owner_user_id IS NULL → no recipient → skip silently (no fallback for
  // deadline tier; only stages cascade up to deadline owner).
  const rows = await db.execute<{
    user_id: string;
    user_email: string;
    user_full_name: string | null;
    org_id: string;
    org_name: string;
    deadline_instance_id: string;
    rule_title: string;
    form_code: string;
    jurisdiction_code: string;
    effective_due_date: string;
    irrevocable: boolean;
    entity_name: string;
    client_id: string;
    client_name: string;
  }>(sql`
    SELECT u.id AS user_id,
           u.email AS user_email,
           u.full_name AS user_full_name,
           o.id AS org_id,
           o.name AS org_name,
           di.id AS deadline_instance_id,
           r.title AS rule_title,
           r.form_code,
           r.jurisdiction_code,
           COALESCE(di.extension_due_date, di.due_date)::text AS effective_due_date,
           r.irrevocable,
           e.name AS entity_name,
           c.id AS client_id,
           c.name AS client_name
    FROM deadline_instances di
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    INNER JOIN organizations o ON o.id = di.org_id
    INNER JOIN users u ON u.id = di.owner_user_id
    WHERE di.completed_at IS NULL
      AND di.owner_user_id IS NOT NULL
      AND COALESCE(di.extension_due_date, di.due_date) = ${target}::date
    ORDER BY di.org_id, c.name, e.name
  `);

  return rows.rows.map((r) => ({
    kind,
    userId: r.user_id,
    userEmail: r.user_email,
    userFullName: r.user_full_name,
    orgId: r.org_id,
    orgName: r.org_name,
    deadlineInstanceId: r.deadline_instance_id,
    ruleTitle: r.rule_title,
    formCode: r.form_code,
    jurisdictionCode: r.jurisdiction_code,
    effectiveDueDate: r.effective_due_date,
    irrevocable: r.irrevocable,
    entityName: r.entity_name,
    clientId: r.client_id,
    clientName: r.client_name,
    subtaskId: null,
    subtaskLabel: null,
    subtaskDueDate: null,
  }));
}

async function findStageCandidates(
  asOf: Date,
): Promise<ReminderCandidate[]> {
  const db = getDb();
  const target = addDaysIso(asOf, 1);

  // Recipient = COALESCE(subtask.owner_user_id, deadline.owner_user_id).
  // If both are NULL, skip (nobody to notify). Schema's design intent
  // (see deadline_subtasks comments): NULL stage owner inherits parent.
  const rows = await db.execute<{
    user_id: string;
    user_email: string;
    user_full_name: string | null;
    org_id: string;
    org_name: string;
    deadline_instance_id: string;
    rule_title: string;
    form_code: string;
    jurisdiction_code: string;
    effective_due_date: string;
    irrevocable: boolean;
    entity_name: string;
    client_id: string;
    client_name: string;
    subtask_id: string;
    subtask_label: string;
    subtask_due_date: string;
  }>(sql`
    SELECT u.id AS user_id,
           u.email AS user_email,
           u.full_name AS user_full_name,
           o.id AS org_id,
           o.name AS org_name,
           di.id AS deadline_instance_id,
           r.title AS rule_title,
           r.form_code,
           r.jurisdiction_code,
           COALESCE(di.extension_due_date, di.due_date)::text AS effective_due_date,
           r.irrevocable,
           e.name AS entity_name,
           c.id AS client_id,
           c.name AS client_name,
           s.id AS subtask_id,
           s.label AS subtask_label,
           s.due_date::text AS subtask_due_date
    FROM deadline_subtasks s
    INNER JOIN deadline_instances di ON di.id = s.deadline_instance_id
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    INNER JOIN organizations o ON o.id = s.org_id
    INNER JOIN users u ON u.id = COALESCE(s.owner_user_id, di.owner_user_id)
    WHERE s.completed_at IS NULL
      AND s.due_date = ${target}::date
      AND COALESCE(s.owner_user_id, di.owner_user_id) IS NOT NULL
    ORDER BY s.org_id, c.name, s.due_date
  `);

  return rows.rows.map((r) => ({
    kind: "stage_t_minus_1" as const,
    userId: r.user_id,
    userEmail: r.user_email,
    userFullName: r.user_full_name,
    orgId: r.org_id,
    orgName: r.org_name,
    deadlineInstanceId: r.deadline_instance_id,
    ruleTitle: r.rule_title,
    formCode: r.form_code,
    jurisdictionCode: r.jurisdiction_code,
    effectiveDueDate: r.effective_due_date,
    irrevocable: r.irrevocable,
    entityName: r.entity_name,
    clientId: r.client_id,
    clientName: r.client_name,
    subtaskId: r.subtask_id,
    subtaskLabel: r.subtask_label,
    subtaskDueDate: r.subtask_due_date,
  }));
}

// ---------------------------------------------------------------------------
// Render — denormalized fields for the notifications row + email body.
// Both share the same "subject line" so the bell title matches what the
// CPA saw in their inbox.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "Due in 7 days" / "Due in 3 days" / "Due tomorrow". */
function dueWindowLabel(kind: ReminderKind): string {
  switch (kind) {
    case "deadline_t_minus_7":
      return "Due in 7 days";
    case "deadline_t_minus_3":
      return "Due in 3 days";
    case "deadline_t_minus_1":
    case "stage_t_minus_1":
      return "Due tomorrow";
  }
}

function notificationTitle(c: ReminderCandidate): string {
  if (c.kind === "stage_t_minus_1") {
    return `Stage: ${c.subtaskLabel} — ${c.clientName}`;
  }
  return `${c.formCode} · ${c.clientName}`;
}

function notificationBody(c: ReminderCandidate): string {
  // "Due in 7 days · Tue Mar 10" — keep one-liner short for the popover row.
  const date =
    c.kind === "stage_t_minus_1"
      ? c.subtaskDueDate ?? c.effectiveDueDate
      : c.effectiveDueDate;
  return `${dueWindowLabel(c.kind)} · ${fmtDate(date)}`;
}

function renderReminderEmail(c: ReminderCandidate, appUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  const window = dueWindowLabel(c.kind);
  const isStage = c.kind === "stage_t_minus_1";
  const dateIso = isStage ? c.subtaskDueDate ?? c.effectiveDueDate : c.effectiveDueDate;
  const formattedDate = fmtDate(dateIso);
  const link = `${appUrl}/deadlines/${c.deadlineInstanceId}`;
  const greeting = c.userFullName?.trim() || c.userEmail.split("@")[0];

  const subject = isStage
    ? `[Tomorrow] Stage: ${c.subtaskLabel} — ${c.clientName}`
    : `[${c.kind === "deadline_t_minus_1" ? "Tomorrow" : `${c.kind === "deadline_t_minus_7" ? "7 days" : "3 days"}`}] ${c.formCode} due ${formattedDate} for ${c.clientName}`;

  const headline = isStage
    ? `${c.subtaskLabel} for ${c.clientName}`
    : `${c.ruleTitle} for ${c.clientName}`;

  const detailLines: string[] = [
    `Form: ${c.formCode}`,
    `Entity: ${c.entityName}`,
    `Due: ${formattedDate}`,
    `Jurisdiction: ${c.jurisdictionCode}`,
  ];
  if (c.irrevocable) {
    detailLines.push("⚠ Irrevocable — cannot be filed late.");
  }

  const text = [
    `Hi ${greeting},`,
    "",
    `${window} — ${headline}.`,
    "",
    ...detailLines,
    "",
    `Open in DueDateHQ: ${link}`,
    "",
    "— DueDateHQ",
  ].join("\n");

  const detailHtml = detailLines
    .map(
      (line) =>
        `<li style="margin:4px 0;color:#475569">${escapeHtml(line)}</li>`,
    )
    .join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;color:#1B1B1F">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
  <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#94928E;font-weight:600;margin-bottom:8px">
    ${escapeHtml(window)}
  </div>
  <h1 style="font-size:22px;font-weight:600;margin:0 0 8px;line-height:1.3">
    ${escapeHtml(headline)}
  </h1>
  <div style="font-size:14px;color:#5C5A5C;margin-bottom:24px">${escapeHtml(c.orgName)}</div>
  <ul style="list-style:none;padding:0;margin:0 0 28px;background:#FFFFFF;border:1px solid #ECEAE5;border-radius:14px;padding:18px 20px">
    ${detailHtml}
  </ul>
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#1B1B1F;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;font-size:14px">
    Open in DueDateHQ →
  </a>
  <div style="font-size:11px;color:#94928E;margin-top:32px">
    Sent because you own this ${isStage ? "stage" : "deadline"} on DueDateHQ.
  </div>
</div>
</body></html>`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Single-candidate dispatch — INSERT notification first (idempotency lock),
// then send email. Email failure is non-fatal: the in-app feed already has it.
// ---------------------------------------------------------------------------

async function dispatchOne(
  c: ReminderCandidate,
  appUrl: string,
  resend: Resend | null,
  fromEmail: string,
): Promise<{
  outcome: DispatchOutcome;
  errorMessage?: string;
}> {
  const db = getDb();
  const linkPath = `/deadlines/${c.deadlineInstanceId}`;
  const title = notificationTitle(c);
  const body = notificationBody(c);

  // Idempotency lock: INSERT ON CONFLICT DO NOTHING. RETURNING tells us
  // whether the row was newly inserted or already existed.
  const inserted = await db
    .insert(notifications)
    .values({
      orgId: c.orgId,
      userId: c.userId,
      kind: c.kind,
      deadlineInstanceId: c.deadlineInstanceId,
      subtaskId: c.subtaskId,
      title,
      body,
      linkPath,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (inserted.length === 0) {
    // Already fired this combo on a previous run.
    return { outcome: "skipped" };
  }

  // Email send. Resend client may be null in dev (no API key) — log + treat
  // as "sent" since the in-app fired. The real cron always has a key.
  if (!resend) {
    console.warn(
      `[reminders] RESEND_API_KEY not set — would have sent to ${c.userEmail} (${c.kind} for ${c.deadlineInstanceId})`,
    );
    return { outcome: "sent" };
  }

  const { subject, html, text } = renderReminderEmail(c, appUrl);
  try {
    const result = await resend.emails.send({
      from: fromEmail,
      to: c.userEmail,
      subject,
      html,
      text,
    });
    if (result.error) {
      const msg = `Resend ${result.error.name ?? "error"}: ${result.error.message}`;
      console.error("[reminders] resend rejected:", msg, {
        from: fromEmail,
        to: c.userEmail,
        kind: c.kind,
      });
      return { outcome: "failed", errorMessage: msg };
    }
    return { outcome: "sent" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[reminders] send threw:", message);
    return { outcome: "failed", errorMessage: message };
  }
}

// ---------------------------------------------------------------------------
// Top-level entry point — used by /api/cron/reminders and manual triggers.
// Sequential dispatch (pilot scale, well below Resend rate limits).
// ---------------------------------------------------------------------------

export async function dispatchAllReminders(
  asOf: Date = new Date(),
): Promise<DispatchRemindersResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? "DueDateHQ <onboarding@resend.dev>";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://duedatehq.com";
  const resend = apiKey ? new Resend(apiKey) : null;

  const candidates: ReminderCandidate[] = [
    ...(await findDeadlineCandidates(asOf, 7)),
    ...(await findDeadlineCandidates(asOf, 3)),
    ...(await findDeadlineCandidates(asOf, 1)),
    ...(await findStageCandidates(asOf)),
  ];

  const result: DispatchRemindersResult = {
    asOfIso: todayUtcIso(asOf),
    attempted: candidates.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    byKind: {
      deadline_t_minus_7: { attempted: 0, sent: 0, skipped: 0, failed: 0 },
      deadline_t_minus_3: { attempted: 0, sent: 0, skipped: 0, failed: 0 },
      deadline_t_minus_1: { attempted: 0, sent: 0, skipped: 0, failed: 0 },
      stage_t_minus_1: { attempted: 0, sent: 0, skipped: 0, failed: 0 },
    },
    errors: [],
  };

  for (const c of candidates) {
    result.byKind[c.kind].attempted++;
    try {
      const { outcome, errorMessage } = await dispatchOne(
        c,
        appUrl,
        resend,
        fromEmail,
      );
      result[outcome]++;
      result.byKind[c.kind][outcome]++;
      if (outcome === "failed" && errorMessage) {
        result.errors.push({
          kind: c.kind,
          deadlineInstanceId: c.deadlineInstanceId,
          subtaskId: c.subtaskId,
          userId: c.userId,
          error: errorMessage,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(
        `[reminders] unexpected error for ${c.kind} ${c.deadlineInstanceId}:`,
        message,
      );
      result.failed++;
      result.byKind[c.kind].failed++;
      result.errors.push({
        kind: c.kind,
        deadlineInstanceId: c.deadlineInstanceId,
        subtaskId: c.subtaskId,
        userId: c.userId,
        error: message,
      });
    }
  }

  // Audit one rollup row per cron run, not per fire — keeps the log
  // browseable (300 sends/day would otherwise drown out everything else).
  // The org_id on a cron-wide rollup is conventionally the first org we
  // touched; if the run was a no-op, audit is skipped.
  const firstCandidate = candidates[0];
  if (firstCandidate) {
    try {
      await recordAudit({
        orgId: firstCandidate.orgId,
        actorType: "cron",
        actorId: "reminders",
        action: "reminders.dispatched",
        targetType: "cron_run",
        targetId: result.asOfIso,
        payload: {
          attempted: result.attempted,
          sent: result.sent,
          skipped: result.skipped,
          failed: result.failed,
          byKind: result.byKind,
          errorCount: result.errors.length,
        },
      });
    } catch (e) {
      console.error("[reminders] audit write failed (non-fatal):", e);
    }
  }

  return result;
}
