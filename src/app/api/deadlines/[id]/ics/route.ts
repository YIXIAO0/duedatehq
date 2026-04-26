/**
 * Single-deadline iCal download.
 *
 * URL pattern: /api/deadlines/<id>/ics
 *
 * Unlike the subscription endpoint (token-bearer auth), this is
 * session-authenticated — only signed-in users from the deadline's
 * org can download. Returns a one-shot .ics file the user double-clicks
 * to add into their default calendar app. No subscription, no refresh
 * — just "block this date on my calendar right now".
 *
 * Different from the subscription:
 *   - filename triggers download (Content-Disposition: attachment)
 *   - no refresh interval (it's one event)
 *   - includes the deadline notes verbatim (subscription does too,
 *     but here the user is consciously sharing it with their cal so
 *     full context is fine)
 */

import { NextRequest } from "next/server";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDeadlineDetail } from "@/lib/services/deadlines";
import { buildIcs } from "@/lib/ical/generate";

export const dynamic = "force-dynamic";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://duedatehq.com";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id } = await params;

  try {
    const ctx = await getCurrentContext();
    const d = await getDeadlineDetail(id, ctx.organization.id);
    if (!d) {
      return new Response("Not found", { status: 404 });
    }

    const effective = d.extension_due_date ?? d.due_date;
    const summary = `${d.rule_form_code} — ${d.client_name}`;
    const lines = [
      d.rule_title,
      `Jurisdiction: ${
        d.rule_jurisdiction_code === "federal"
          ? "US Federal (IRS)"
          : d.rule_jurisdiction_code
      }`,
      `Entity: ${d.entity_name ?? "-"}`,
    ];
    if (d.notes) lines.push("", `Notes: ${d.notes}`);
    lines.push("", `Open in DueDateHQ: ${APP_URL}/deadlines/${d.id}`);

    const ics = buildIcs({
      calendarName: summary,
      events: [
        {
          uid: d.id,
          startDate: effective,
          summary,
          description: lines.join("\n"),
          url: `${APP_URL}/deadlines/${d.id}`,
          alarmDaysBefore: 1,
        },
      ],
    });

    // Filename uses form code + due date so the file is recognizable in
    // the Downloads folder. Sanitize aggressively because some form
    // codes contain dashes/digits we want to keep but nothing else.
    const safeFormCode = d.rule_form_code.replace(/[^a-zA-Z0-9-]/g, "");
    const filename = `${safeFormCode}-${effective}.ics`;

    console.log("[ical] downloaded single event", {
      orgId: ctx.organization.id,
      deadlineId: d.id,
      ms: Date.now() - startedAt,
    });

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[ical] single-event download failed", {
      deadlineId: id,
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      ms: Date.now() - startedAt,
    });
    return new Response("Internal error", { status: 500 });
  }
}
