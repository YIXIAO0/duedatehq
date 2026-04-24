/**
 * Weekly digest cron — Monday 12:00 UTC (= 7am EST / 8am EDT).
 *
 * Iterates every membership and sends each user their org's weekly summary.
 * Idempotent at the (user, week) level — a second invocation in the same
 * ISO week is a no-op.
 *
 * Hardened against:
 *   - Vercel duplicate fires (idempotent INSERT).
 *   - Single user failure poisoning the whole run (errors are caught
 *     per-recipient, summed in the response).
 *   - Manual trigger abuse (CRON_SECRET required even for `?force=1`).
 *
 * Manual usage:
 *   GET /api/cron/weekly-digest?force=1
 *   Authorization: Bearer $CRON_SECRET
 *
 * Vercel sets the Authorization header automatically when invoked from a
 * configured cron — see vercel.ts for the schedule.
 */

import { NextResponse } from "next/server";
import { dispatchAllWeeklyDigests } from "@/lib/services/digest";

// Even with our pilot scale this is a slow loop (one Resend send per user,
// plus an AI call per user). Bump max duration so we don't trip 300s default
// on busy days. Vercel Functions accept up to 800 on Pro / Fluid Compute.
export const maxDuration = 600;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const result = await dispatchAllWeeklyDigests();
    const durationMs = Date.now() - startedAt;
    console.log(
      `[cron/weekly-digest] week=${result.weekKey} attempted=${result.attempted} sent=${result.sent} skipped=${result.skipped} failed=${result.failed} duration_ms=${durationMs}`,
    );
    return NextResponse.json({ ok: true, durationMs, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/weekly-digest] fatal:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
