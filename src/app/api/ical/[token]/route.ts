/**
 * Public iCal subscription endpoint.
 *
 * URL pattern: /api/ical/<token>.ics
 *
 * Token is bearer auth — anyone with the URL can read the calendar.
 * That's intentional: Google Cal / Outlook / Apple Cal pull from this
 * URL on a schedule and can't carry session cookies. Treat the token
 * like a password (rotate-able from /settings, revocable to NULL).
 *
 * The ".ics" suffix is optional in the URL; some calendar clients
 * append it automatically when subscribing, others don't. We strip
 * it before lookup so both work.
 */

import { NextRequest } from "next/server";
import { resolveIcalToken } from "@/lib/services/ical-tokens";
import { listDeadlinesForOrgIcal } from "@/lib/services/deadlines";
import { buildIcs } from "@/lib/ical/generate";

// Note: previously exported `dynamic = "force-dynamic"` here — Next.js
// 16 with Cache Components enabled rejects that segment config. The
// route is naturally dynamic anyway: it reads `params.token` and
// per-request `request.headers`, both of which opt it out of any
// framework-level caching. We do set an HTTP Cache-Control on the
// response so upstream caches (Google Calendar's pull cache) keep
// the load down.

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://duedatehq.com";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // Captured upfront so every log line can correlate, even when the
  // handler bails early on a bad token. User-Agent matters here —
  // it's how we distinguish "Google Calendar pulling on schedule"
  // from "someone tested the URL in a browser".
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const startedAt = Date.now();

  try {
    const { token } = await params;
    // Calendar clients sometimes append ".ics", sometimes don't.
    const cleanToken = token.replace(/\.ics$/i, "");

    // 24-byte base64url is 32 chars. Reject obviously-wrong shapes
    // before hitting the DB so token guessing is even more pointless.
    if (cleanToken.length < 16 || cleanToken.length > 100) {
      console.warn("[ical] rejected malformed token", {
        len: cleanToken.length,
        ua: userAgent,
      });
      return new Response("Not found", { status: 404 });
    }

    const sub = await resolveIcalToken(cleanToken);
    if (!sub) {
      // Don't log the token itself — it's bearer auth. Logging a prefix
      // is enough to debug "my calendar suddenly stopped working" (user
      // can compare prefix to their saved URL).
      console.warn("[ical] unknown token", {
        prefix: cleanToken.slice(0, 6),
        ua: userAgent,
      });
      return new Response("Not found", { status: 404 });
    }

    const deadlines = await listDeadlinesForOrgIcal({ orgId: sub.orgId });

    const ics = buildIcs({
    calendarName: `DueDateHQ — ${sub.orgName}`,
    refreshIntervalMinutes: 60, // Apple/Google honor this as a hint
    events: deadlines.map((d) => {
      // Calendar event title: form code + client name. Short, scannable.
      // "1040 — Acme Corp" reads fast on phone notifications.
      const summary =
        d.status === "completed"
          ? `[Filed] ${d.formCode} — ${d.clientName}`
          : d.status === "extended"
          ? `[Ext] ${d.formCode} — ${d.clientName}`
          : `${d.formCode} — ${d.clientName}`;

      const lines = [
        d.ruleTitle,
        `Jurisdiction: ${
          d.jurisdictionCode === "federal"
            ? "US Federal (IRS)"
            : d.jurisdictionCode
        }`,
        `Entity: ${d.entityName}`,
      ];
      if (d.notes) lines.push("", `Notes: ${d.notes}`);
      lines.push("", `Open in DueDateHQ: ${APP_URL}/deadlines/${d.id}`);

      return {
        uid: d.id,
        startDate: d.effectiveDueDate,
        summary,
        description: lines.join("\n"),
        url: `${APP_URL}/deadlines/${d.id}`,
        // Default reminder: 1 day before. CPA can override per-event in
        // their calendar app. Skip the alarm for already-filed items.
        alarmDaysBefore: d.status === "completed" ? undefined : 1,
        lastModified: d.updatedAt,
      };
    }),
  });

    // Success log — useful for debugging "my calendar isn't refreshing"
    // tickets (lets us see if Google Cal is actually pulling and how
    // many events it's seeing). Bytes is a cheap way to spot truncation.
    console.log("[ical] served feed", {
      orgId: sub.orgId,
      events: deadlines.length,
      bytes: ics.length,
      ms: Date.now() - startedAt,
      ua: userAgent,
    });

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        // Inline + suggested filename so "View source" in browsers shows
        // a sensible name without forcing a download.
        "Content-Disposition": `inline; filename="duedatehq-${sub.orgId}.ics"`,
        // 15-min upstream cache. Google Cal refreshes every ~24h anyway,
        // but multiple subscribers in the same org shouldn't hammer DB.
        "Cache-Control": "private, max-age=900",
      },
    });
  } catch (err) {
    // Returning 500 with no body is intentional — calendar clients
    // will retry on their schedule. We log the full error server-side
    // for diagnosis, where Vercel's runtime captures console.error
    // into the deployment's log stream.
    console.error("[ical] feed generation failed", {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      ms: Date.now() - startedAt,
      ua: userAgent,
    });
    return new Response("Internal error", { status: 500 });
  }
}
