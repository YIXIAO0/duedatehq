/**
 * Daily announcements scrape cron — fans out across every registered source.
 *
 * Two modes:
 *   default              → fire-and-forget. Returns the runIds immediately,
 *                          each per-source workflow keeps going in the
 *                          background. Vercel Cron only needs to see a 200.
 *
 *   ?wait=1              → block until all source workflows complete.
 *                          Useful for manual smoke testing.
 *
 *   ?source=<id>         → only run the named source (e.g. `?source=tx_comptroller`).
 *                          Used for per-source debugging without firing the
 *                          full fan-out. Combine with `?wait=1` to inspect
 *                          the result inline.
 *
 * Auth: CRON_SECRET (Bearer token) — Vercel Cron sets this header. Manual
 * triggers from a browser will be rejected; use curl with the matching
 * token, or the dashboard "Run now" button.
 */

import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { scrapeAnnouncementsWorkflow } from "@/lib/workflows/scrape-announcements";
import { ALL_SOURCE_IDS } from "@/lib/workflows/sources";

// Generous duration so the manual `?wait=1` mode can sit through a
// full classify-N-items cycle across multiple sources. The fire-and-
// forget path returns in <2s.
export const maxDuration = 600;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const wait = url.searchParams.get("wait") === "1";
  const onlySource = url.searchParams.get("source");

  // Resolve which sources to fire. Default = all registered. `?source=`
  // narrows to a single id (must be known, otherwise 400 — easier to
  // catch typos than to silently no-op).
  let sourceIds: string[];
  if (onlySource) {
    if (!ALL_SOURCE_IDS.includes(onlySource)) {
      return NextResponse.json(
        {
          error: `Unknown source "${onlySource}". Known: ${ALL_SOURCE_IDS.join(", ")}`,
        },
        { status: 400 },
      );
    }
    sourceIds = [onlySource];
  } else {
    sourceIds = ALL_SOURCE_IDS;
  }

  console.log(
    `[cron/scrape-announcements] start wait=${wait} sources=${sourceIds.join(",")}`,
  );
  const t0 = Date.now();

  try {
    // Start every source's workflow in parallel — each gets its own
    // runId and its own step cache, so a flaky source doesn't block
    // the others.
    const runs = await Promise.all(
      sourceIds.map((id) => start(scrapeAnnouncementsWorkflow, [id])),
    );
    const runMeta = runs.map((r, i) => ({
      sourceId: sourceIds[i],
      runId: r.runId,
    }));

    console.log(
      `[cron/scrape-announcements] started runs=${JSON.stringify(runMeta)} ms=${Date.now() - t0}`,
    );

    if (!wait) {
      return NextResponse.json({
        ok: true,
        mode: "started",
        runs: runMeta,
        durationMs: Date.now() - t0,
      });
    }

    // Manual / smoke-test mode — block until every source's workflow
    // returns. Each `returnValue` resolves independently; one slow
    // source doesn't break the others' results.
    const results = await Promise.all(runs.map((r) => r.returnValue));
    console.log(
      `[cron/scrape-announcements] done ms=${Date.now() - t0} results=${JSON.stringify(results)}`,
    );
    return NextResponse.json({
      ok: true,
      mode: "completed",
      durationMs: Date.now() - t0,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[cron/scrape-announcements] FAILED:", message, e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
