/**
 * Weekly digest — Monday morning email with "your week ahead".
 *
 * Built for solo CPAs who don't want to log in every day. Mental model:
 * "Inbox-zero my brain on Monday, then go batch-execute."
 *
 * Composition:
 *   1. Numbers: deadlines this week, irrevocables, recently completed.
 *   2. Per-bucket lists (urgent / this-week / next-week).
 *   3. AI insight (1-2 sentences) — calls out anomalies a human might miss
 *      ("3 of your 5 due-Wed clients are S-corps with NJ PTET — make sure
 *      the elections are filed before Wed since they're irrevocable").
 *   4. Direct dashboard link.
 *
 * Idempotency: keyed by (userId, weekKey="YYYY-Www", digestType="weekly").
 * If the cron fires twice in a Monday or a manual trigger is used twice,
 * the unique index on `digest_sends` rejects the duplicate INSERT and we
 * gracefully skip the resend.
 *
 * Sender email respects RESEND_FROM_EMAIL. NB: until the user verifies
 * their own domain on Resend, mail goes from the shared `onboarding@resend.dev`
 * address — Resend will only deliver those to the account owner. Real
 * pilot users need a verified domain (tracked in the progress dashboard).
 */

import "server-only";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { generateText, Output } from "ai";
import { Resend } from "resend";
import { getDb } from "@/lib/db";
import {
  digestSends,
  memberships,
  users,
  organizations,
} from "@/lib/db/schema";
import { recordAudit } from "./audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DigestDeadlineRow = {
  id: string;
  due_date: string;
  effective_due_date: string;
  status: string;
  irrevocable: boolean;
  rule_title: string;
  form_code: string;
  jurisdiction_code: string;
  entity_name: string;
  entity_type: string;
  client_id: string;
  client_name: string;
};

type DigestStats = {
  thisWeek: DigestDeadlineRow[];
  nextWeek: DigestDeadlineRow[];
  irrevocableSoon: DigestDeadlineRow[]; // next 14d, irrevocable=true
  recentlyCompleted: number; // last 7d
  overdue: DigestDeadlineRow[]; // due_date < today and status pending/in_progress/extended
};

export type GenerateDigestResult =
  | { sent: true; messageId: string | null; weekKey: string }
  | {
      sent: false;
      reason: "already-sent" | "no-recipient" | "error";
      weekKey: string;
      /** Present when reason === "error" so the UI can show the real cause. */
      errorMessage?: string;
      /** Where in the pipeline we crashed (for support / logs). */
      errorStage?:
        | "stats"
        | "ai"
        | "render"
        | "send"
        | "record"
        | "unknown";
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** ISO 8601 week key, e.g. 2026-W17. UTC-based for cron determinism. */
export function isoWeekKey(d: Date = new Date()): string {
  // Copy to avoid mutating caller; shift to nearest Thursday (ISO week anchor)
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const weekNum =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

// ---------------------------------------------------------------------------
// Stats query
// ---------------------------------------------------------------------------

async function gatherDigestStats(orgId: string): Promise<DigestStats> {
  const db = getDb();

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // Range: today → today + 14d covers "this week" + "next week" buckets, plus
  // we pull recent overdue + recently completed in separate queries.
  const upcomingRows = await db.execute<DigestDeadlineRow>(sql`
    SELECT di.id,
           di.due_date::text AS due_date,
           COALESCE(di.extension_due_date, di.due_date)::text AS effective_due_date,
           di.status::text AS status,
           r.irrevocable,
           r.title AS rule_title,
           r.form_code,
           r.jurisdiction_code,
           e.name AS entity_name,
           e.entity_type::text AS entity_type,
           c.id AS client_id,
           c.name AS client_name
    FROM deadline_instances di
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    WHERE di.org_id = ${orgId}
      AND di.status IN ('pending', 'waiting_on_client', 'in_progress')
      AND COALESCE(di.extension_due_date, di.due_date) BETWEEN ${todayIso}::date
        AND (${todayIso}::date + INTERVAL '14 days')
    ORDER BY effective_due_date ASC, r.irrevocable DESC
  `);

  const overdueRows = await db.execute<DigestDeadlineRow>(sql`
    SELECT di.id,
           di.due_date::text AS due_date,
           COALESCE(di.extension_due_date, di.due_date)::text AS effective_due_date,
           di.status::text AS status,
           r.irrevocable,
           r.title AS rule_title,
           r.form_code,
           r.jurisdiction_code,
           e.name AS entity_name,
           e.entity_type::text AS entity_type,
           c.id AS client_id,
           c.name AS client_name
    FROM deadline_instances di
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    WHERE di.org_id = ${orgId}
      AND di.status IN ('pending', 'waiting_on_client', 'in_progress')
      AND COALESCE(di.extension_due_date, di.due_date) < ${todayIso}::date
    ORDER BY effective_due_date ASC
    LIMIT 20
  `);

  const completedCountRow = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM deadline_instances
    WHERE org_id = ${orgId}
      AND status = 'completed'
      AND completed_at >= NOW() - INTERVAL '7 days'
  `);
  const recentlyCompleted = Number(completedCountRow.rows[0]?.n ?? 0);

  // Bucket by week
  const weekFromNow = new Date();
  weekFromNow.setUTCDate(weekFromNow.getUTCDate() + 7);
  const weekFromNowIso = weekFromNow.toISOString().slice(0, 10);

  const thisWeek: DigestDeadlineRow[] = [];
  const nextWeek: DigestDeadlineRow[] = [];
  for (const row of upcomingRows.rows) {
    if (row.effective_due_date <= weekFromNowIso) thisWeek.push(row);
    else nextWeek.push(row);
  }

  const irrevocableSoon = upcomingRows.rows.filter((r) => r.irrevocable);

  return {
    thisWeek,
    nextWeek,
    irrevocableSoon,
    recentlyCompleted,
    overdue: overdueRows.rows,
  };
}

// ---------------------------------------------------------------------------
// AI insight (one short paragraph, deterministic on stats)
//
// Kept VERY constrained: temperature 0.3, schema-validated single-line output,
// 60-word cap. CPAs hate AI hallucination — better to be plain than chatty.
// Falls back to a deterministic template if the model errors out.
// ---------------------------------------------------------------------------

const InsightSchema = z.object({
  insight: z
    .string()
    .min(1)
    .max(400)
    .describe("One or two short sentences for a CPA reading on Monday."),
});

async function generateAiInsight(
  stats: DigestStats,
  orgName: string,
): Promise<string> {
  // Build a compact summary for the model — only fields it needs.
  const summary = {
    org: orgName,
    counts: {
      thisWeek: stats.thisWeek.length,
      nextWeek: stats.nextWeek.length,
      irrevocableSoon: stats.irrevocableSoon.length,
      overdue: stats.overdue.length,
      recentlyCompleted: stats.recentlyCompleted,
    },
    topThisWeek: stats.thisWeek.slice(0, 6).map((d) => ({
      due: d.effective_due_date,
      form: d.form_code,
      jurisdiction: d.jurisdiction_code,
      entityType: d.entity_type,
      irrevocable: d.irrevocable,
    })),
    irrevocables: stats.irrevocableSoon.slice(0, 6).map((d) => ({
      due: d.effective_due_date,
      form: d.form_code,
      jurisdiction: d.jurisdiction_code,
    })),
  };

  // Deterministic fallback — used if AI errors. Honest, useful, no fluff.
  function fallback(): string {
    if (stats.overdue.length > 0) {
      return `${stats.overdue.length} overdue from last week — review those first. ${stats.thisWeek.length} more land this week.`;
    }
    if (stats.irrevocableSoon.length > 0) {
      return `${stats.irrevocableSoon.length} irrevocable election${stats.irrevocableSoon.length === 1 ? "" : "s"} due in the next 14 days. File on time — these can't be undone.`;
    }
    if (stats.thisWeek.length === 0) {
      return `No deadlines this week. Calm planning window — good time to onboard a client or chase docs.`;
    }
    return `${stats.thisWeek.length} deadline${stats.thisWeek.length === 1 ? "" : "s"} this week, ${stats.nextWeek.length} next week. ${stats.recentlyCompleted} filed last week — keep it up.`;
  }

  try {
    const { experimental_output: output } = await generateText({
      model: "anthropic/claude-haiku-4.5",
      temperature: 0.3,
      experimental_output: Output.object({ schema: InsightSchema }),
      system:
        "You are a senior CPA's assistant. Generate ONE short, factual sentence (max two) summarizing the week's deadline workload. No greetings. No emoji. No filler. If everything looks normal, say so plainly.",
      prompt: `Workload data for the week ahead:\n${JSON.stringify(summary, null, 2)}`,
    });
    return output.insight.trim();
  } catch {
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// Email rendering
//
// Plain HTML with inline styles — reliable across Gmail, Outlook, Apple Mail.
// Plain-text version included so spam filters don't flag the email.
// ---------------------------------------------------------------------------

function renderEmail(args: {
  recipientName: string;
  orgName: string;
  appUrl: string;
  weekKey: string;
  insight: string;
  stats: DigestStats;
}): { subject: string; html: string; text: string } {
  const { recipientName, orgName, appUrl, weekKey, insight, stats } = args;

  const urgentTotal =
    stats.overdue.length + stats.irrevocableSoon.length;
  const subject = `Week ahead — ${stats.thisWeek.length} deadlines${urgentTotal > 0 ? ` (${urgentTotal} urgent)` : ""}`;

  const greeting = recipientName ? recipientName.split(" ")[0] : "there";

  function rowHtml(d: DigestDeadlineRow): string {
    const irre = d.irrevocable
      ? `<span style="display:inline-block;background:#fee2e2;color:#b91c1c;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600;margin-left:6px">IRREVOCABLE</span>`
      : "";
    const entityNote =
      d.entity_name && d.entity_name !== d.client_name
        ? ` · ${d.entity_name}`
        : "";
    const jurisdiction =
      d.jurisdiction_code === "federal" ? "US Federal" : d.jurisdiction_code;
    return `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a">
          <div style="font-weight:600">${escapeHtml(d.form_code)} — ${escapeHtml(d.client_name)}${irre}</div>
          <div style="color:#64748b;font-size:12px;margin-top:2px">
            ${escapeHtml(fmtDate(d.effective_due_date))} · ${escapeHtml(jurisdiction)} · ${escapeHtml(entityLabel(d.entity_type))}${escapeHtml(entityNote)}
          </div>
        </td>
      </tr>`;
  }

  function section(label: string, rows: DigestDeadlineRow[]): string {
    if (rows.length === 0) return "";
    return `
      <h2 style="font-size:13px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.05em;margin:24px 0 8px">${escapeHtml(label)} (${rows.length})</h2>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" role="presentation">
        ${rows.slice(0, 15).map(rowHtml).join("")}
      </table>
      ${rows.length > 15 ? `<div style="font-size:12px;color:#64748b;margin-top:6px">+ ${rows.length - 15} more — see dashboard</div>` : ""}
    `;
  }

  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" role="presentation" style="background:#f8fafc;padding:32px 12px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="600" role="presentation" style="max-width:600px;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0;padding:32px">
        <tr><td>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:600">Week of ${escapeHtml(weekKey)}</div>
          <h1 style="font-size:22px;font-weight:600;margin:6px 0 0;color:#0f172a">Hi ${escapeHtml(greeting)} — your week ahead</h1>
          <p style="color:#475569;font-size:14px;margin:6px 0 0">${escapeHtml(orgName)}</p>

          <div style="margin:20px 0;padding:16px;background:#f1f5f9;border-radius:6px;font-size:14px;line-height:1.5;color:#1e293b">
            ${escapeHtml(insight)}
          </div>

          <table cellpadding="0" cellspacing="0" border="0" width="100%" role="presentation" style="margin:24px 0">
            <tr>
              ${statBlock("This week", stats.thisWeek.length)}
              ${statBlock("Next week", stats.nextWeek.length)}
              ${statBlock("Irrevocable ≤14d", stats.irrevocableSoon.length, stats.irrevocableSoon.length > 0 ? "#b91c1c" : undefined)}
              ${statBlock("Filed last week", stats.recentlyCompleted, "#15803d")}
            </tr>
          </table>

          ${stats.overdue.length > 0 ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 14px;margin:8px 0 0">
            <div style="font-size:13px;font-weight:600;color:#991b1b">⚠ ${stats.overdue.length} overdue</div>
            <div style="font-size:12px;color:#7f1d1d;margin-top:2px">Review these before anything else.</div>
          </div>` : ""}

          ${section("Overdue", stats.overdue)}
          ${section("This week", stats.thisWeek)}
          ${section("Irrevocable in next 14 days", stats.irrevocableSoon.filter((r) => !stats.thisWeek.includes(r)))}
          ${section("Next week", stats.nextWeek)}

          <div style="margin-top:32px;text-align:center">
            <a href="${escapeHtml(appUrl)}/dashboard" style="display:inline-block;background:#1e40af;color:#ffffff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">Open dashboard →</a>
          </div>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 16px">
          <p style="font-size:11px;color:#94a3b8;line-height:1.5;margin:0">
            You're receiving this because you have an account at ${escapeHtml(orgName)} on DueDateHQ.
            Sent on Monday morning so you can plan your week.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`.trim();

  // Plain text fallback
  function rowText(d: DigestDeadlineRow): string {
    const irre = d.irrevocable ? " [IRREVOCABLE]" : "";
    const j = d.jurisdiction_code === "federal" ? "US Federal" : d.jurisdiction_code;
    const entityNote =
      d.entity_name && d.entity_name !== d.client_name ? ` · ${d.entity_name}` : "";
    return `  - ${fmtDate(d.effective_due_date)} · ${d.form_code} — ${d.client_name}${irre} (${j} · ${entityLabel(d.entity_type)}${entityNote})`;
  }
  function sectionText(label: string, rows: DigestDeadlineRow[]): string {
    if (rows.length === 0) return "";
    return `\n${label.toUpperCase()} (${rows.length})\n${rows.slice(0, 15).map(rowText).join("\n")}${rows.length > 15 ? `\n  ...+ ${rows.length - 15} more` : ""}\n`;
  }
  const text = `
Week of ${weekKey} — your week ahead
${orgName}

${insight}

This week: ${stats.thisWeek.length}
Next week: ${stats.nextWeek.length}
Irrevocable ≤14d: ${stats.irrevocableSoon.length}
Filed last week: ${stats.recentlyCompleted}
${stats.overdue.length > 0 ? `\n⚠ ${stats.overdue.length} OVERDUE — review first.\n` : ""}
${sectionText("Overdue", stats.overdue)}${sectionText("This week", stats.thisWeek)}${sectionText("Irrevocable in next 14 days", stats.irrevocableSoon.filter((r) => !stats.thisWeek.includes(r)))}${sectionText("Next week", stats.nextWeek)}

Open dashboard: ${appUrl}/dashboard
`.trim();

  return { subject, html, text };
}

function statBlock(label: string, value: number, color?: string): string {
  const c = color ?? "#0f172a";
  return `
    <td align="center" style="padding:8px 4px">
      <div style="font-size:24px;font-weight:600;color:${c}">${value}</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-top:2px">${escapeHtml(label)}</div>
    </td>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Top-level entrypoint — used by both cron route and manual trigger
// ---------------------------------------------------------------------------

export const GenerateDigestInputSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  recipientEmail: z.string().email(),
  recipientName: z.string().nullable().default(null),
  orgName: z.string().min(1),
  /** Override "now" for tests/manual triggers. */
  asOf: z.date().optional(),
  /** Skip the dedupe check — useful for manual "send me this week's digest now". */
  force: z.boolean().default(false),
});
export type GenerateDigestInput = z.input<typeof GenerateDigestInputSchema>;

export async function generateAndSendWeeklyDigest(
  input: GenerateDigestInput,
): Promise<GenerateDigestResult> {
  const parsed = GenerateDigestInputSchema.parse(input);
  const db = getDb();
  const weekKey = isoWeekKey(parsed.asOf ?? new Date());

  if (!parsed.recipientEmail) {
    return { sent: false, reason: "no-recipient", weekKey };
  }

  // Idempotency: short-circuit if we already sent this week (unless forced).
  if (!parsed.force) {
    const existing = await db
      .select({ id: digestSends.id })
      .from(digestSends)
      .where(
        and(
          eq(digestSends.userId, parsed.userId),
          eq(digestSends.weekKey, weekKey),
          eq(digestSends.digestType, "weekly"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return { sent: false, reason: "already-sent", weekKey };
    }
  }

  // Pipeline stages — each wrapped so a failure surfaces the exact stage
  // instead of returning an opaque "server error". Lets the UI show
  // actionable messages like "Resend rejected: domain not verified".
  let stats: DigestStats;
  try {
    stats = await gatherDigestStats(parsed.orgId);
  } catch (e) {
    return digestError("stats", e, weekKey);
  }

  let insight: string;
  try {
    insight = await generateAiInsight(stats, parsed.orgName);
  } catch (e) {
    // generateAiInsight itself catches AI errors and falls back to a
    // template — landing here means the fallback also crashed (rare).
    return digestError("ai", e, weekKey);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://duedatehq.com";
  let subject: string, html: string, text: string;
  try {
    ({ subject, html, text } = renderEmail({
      recipientName: parsed.recipientName ?? "",
      orgName: parsed.orgName,
      appUrl,
      weekKey,
      insight,
      stats,
    }));
  } catch (e) {
    return digestError("render", e, weekKey);
  }

  // Send via Resend. If the API key is missing, we silently log + record so
  // local dev / preview without a key can still exercise the flow.
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ?? "DueDateHQ <onboarding@resend.dev>";

  let messageId: string | null = null;
  if (apiKey) {
    try {
      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from: fromEmail,
        to: parsed.recipientEmail,
        subject,
        html,
        text,
      });
      if (result.error) {
        // Resend's most common rejection: "You can only send testing emails
        // to your own email address" — happens when from-domain is the
        // shared `onboarding@resend.dev`. Surface verbatim so the user
        // knows what knob to turn.
        const msg = `Resend ${result.error.name ?? "error"}: ${result.error.message}`;
        console.error("[digest] resend rejected:", msg, {
          from: fromEmail,
          to: parsed.recipientEmail,
        });
        return {
          sent: false,
          reason: "error",
          errorStage: "send",
          errorMessage: msg,
          weekKey,
        };
      }
      messageId = result.data?.id ?? null;
    } catch (e) {
      return digestError("send", e, weekKey);
    }
  } else {
    console.warn(
      "[digest] RESEND_API_KEY not set — would have sent to",
      parsed.recipientEmail,
    );
  }

  try {
    // Insert dedupe record. onConflictDoNothing handles the rare race where
    // two cron ticks fire ~simultaneously.
    await db
      .insert(digestSends)
      .values({
        orgId: parsed.orgId,
        userId: parsed.userId,
        weekKey,
        digestType: "weekly",
        recipientEmail: parsed.recipientEmail,
        deadlineCount: stats.thisWeek.length + stats.nextWeek.length,
        urgentCount: stats.overdue.length + stats.irrevocableSoon.length,
        aiSummary: insight,
        providerMessageId: messageId,
      })
      .onConflictDoNothing();

    await recordAudit({
      orgId: parsed.orgId,
      actorType: "cron",
      actorId: "weekly-digest",
      action: "digest.sent",
      targetType: "user",
      targetId: parsed.userId,
      payload: {
        weekKey,
        recipientEmail: parsed.recipientEmail,
        deadlineCount: stats.thisWeek.length + stats.nextWeek.length,
        urgentCount: stats.overdue.length + stats.irrevocableSoon.length,
        providerMessageId: messageId,
      },
    });
  } catch (e) {
    // The mail already went out at this point — log loudly but don't claim
    // failure to the caller, otherwise they'd resend and get a duplicate.
    console.error(
      "[digest] post-send bookkeeping failed (mail did go out):",
      e,
    );
  }

  return { sent: true, messageId, weekKey };
}

function digestError(
  stage: "stats" | "ai" | "render" | "send" | "record",
  e: unknown,
  weekKey: string,
): GenerateDigestResult {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[digest] failed at stage=${stage}:`, message);
  return {
    sent: false,
    reason: "error",
    errorStage: stage,
    errorMessage: message,
    weekKey,
  };
}

// ---------------------------------------------------------------------------
// Cron fan-out — query every (user, org) membership and dispatch one digest
// per recipient. Sequential to keep things simple and well below Resend rate
// limits at the pilot scale (<50 users).
// ---------------------------------------------------------------------------

export type DispatchDigestsResult = {
  weekKey: string;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: Array<{ userId: string; error: string }>;
};

export async function dispatchAllWeeklyDigests(): Promise<DispatchDigestsResult> {
  const db = getDb();
  const weekKey = isoWeekKey();

  const recipients = await db
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      orgId: organizations.id,
      orgName: organizations.name,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(organizations, eq(organizations.id, memberships.orgId));

  const result: DispatchDigestsResult = {
    weekKey,
    attempted: recipients.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const r of recipients) {
    try {
      const out = await generateAndSendWeeklyDigest({
        orgId: r.orgId,
        userId: r.userId,
        recipientEmail: r.email,
        recipientName: r.fullName,
        orgName: r.orgName,
      });
      if (out.sent) result.sent++;
      else result.skipped++;
    } catch (e) {
      result.failed++;
      result.errors.push({
        userId: r.userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
