/**
 * Daily reminder cron — hit by Vercel Cron at 06:00 UTC every day.
 *
 * Fires the C-3 pipeline:
 *   - deadline_t_minus_{7,3,1} → deadline owners
 *   - stage_t_minus_1          → stage owners (NULL falls back to deadline owner)
 *
 * Each candidate gets one row in `notifications` (popover feed) + one email
 * via Resend. Idempotency lives on the notifications unique constraint —
 * see lib/services/reminders.ts for the rationale.
 *
 * Protected by CRON_SECRET — Vercel Cron sets the `Authorization` header.
 * https://vercel.com/docs/cron-jobs#securing-cron-jobs
 *
 * Manual usage (e.g. seed → trigger → inspect popover):
 *   GET /api/cron/reminders
 *   Authorization: Bearer $CRON_SECRET
 *
 * Optional dev override: ?as_of=YYYY-MM-DD lets you simulate "today" so
 * a candidate query against today+7d hits a deadline already in the seed.
 * The CRON_SECRET guard still applies.
 */

import { NextResponse } from "next/server";
import { dispatchAllReminders } from "@/lib/services/reminders";

// One Resend send + one DB insert per candidate. At pilot scale (a few
// dozen candidates per day) this completes in seconds, but bump to match
// weekly-digest so a busy day during tax season doesn't trip the default.
export const maxDuration = 600;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const asOfParam = url.searchParams.get("as_of");
  const asOf = asOfParam ? new Date(`${asOfParam}T06:00:00Z`) : new Date();
  if (asOfParam && Number.isNaN(asOf.getTime())) {
    return NextResponse.json(
      { error: "Invalid as_of — expected YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const startedAt = Date.now();

  try {
    const result = await dispatchAllReminders(asOf);
    const durationMs = Date.now() - startedAt;
    console.log(
      `[cron/reminders] as_of=${result.asOfIso} attempted=${result.attempted} sent=${result.sent} skipped=${result.skipped} failed=${result.failed} duration_ms=${durationMs}`,
    );
    return NextResponse.json({ ok: true, durationMs, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/reminders] fatal:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
