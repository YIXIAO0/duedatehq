/**
 * Daily IRS Newsroom scrape cron — fires the Workflow DevKit run.
 *
 * Two modes:
 *   default   → fire-and-forget. Returns the runId immediately, the
 *               workflow keeps going in the background. Vercel Cron
 *               only needs to see a 200 to consider the trigger done.
 *
 *   ?wait=1   → block until the workflow returns. Useful for manual
 *               smoke testing, also for deciding whether to surface
 *               results in a synchronous UI flow later.
 *
 * Auth: CRON_SECRET (Bearer token) — Vercel Cron sets this header.
 * Manual triggers from a browser will be rejected; use curl with the
 * matching token, or the dashboard "Run now" button (added in 8b).
 */

import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { scrapeAnnouncementsWorkflow } from "@/lib/workflows/scrape-announcements";

// Generous duration so the manual `?wait=1` mode can sit through a
// full classify-N-items cycle. Cron's typical fire-and-forget call
// returns in <2s.
export const maxDuration = 600;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const wait = url.searchParams.get("wait") === "1";

  console.log(`[cron/scrape-announcements] start wait=${wait}`);
  const t0 = Date.now();

  try {
    const run = await start(scrapeAnnouncementsWorkflow);
    console.log(
      `[cron/scrape-announcements] started runId=${run.runId} ms=${Date.now() - t0}`,
    );

    if (!wait) {
      // Fire-and-forget mode (default for the daily cron).
      return NextResponse.json({
        ok: true,
        runId: run.runId,
        mode: "started",
        durationMs: Date.now() - t0,
      });
    }

    // Manual / smoke-test mode — block until done. Useful so the
    // operator sees full counts in the response.
    const result = await run.returnValue;
    console.log(
      `[cron/scrape-announcements] done runId=${run.runId} ms=${Date.now() - t0} result=${JSON.stringify(result)}`,
    );
    return NextResponse.json({
      ok: true,
      runId: run.runId,
      mode: "completed",
      durationMs: Date.now() - t0,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/scrape-announcements] FAILED:", message, e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
