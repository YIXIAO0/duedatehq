/**
 * PDF export of upcoming deadlines for the current org.
 *
 * Use cases:
 *   - CPA pins it to the wall on Monday morning
 *   - Send a partner / staff member the same view
 *   - Email a client a shorter range ("here's your year ahead")
 *
 * Same auth model as CSV export — proxy.ts gates access via Clerk.
 *
 * Query params:
 *   ?range=60   number of days forward (default 60, max 365)
 *
 * Pinned to Node.js runtime — @react-pdf/renderer needs the full Node API
 * (Buffer, streams). Edge runtime would error at import time.
 */

import { sql } from "drizzle-orm";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";
import {
  DeadlineReport,
  type ReportDeadline,
} from "@/lib/pdf/deadline-report";

// Note: Cache Components is enabled at the project level, which forbids
// per-route `runtime` declarations. Node.js runtime is the default for
// route handlers — and we need it: @react-pdf/renderer pulls in Buffer
// and Node streams, neither of which exist in the Edge runtime.
export const maxDuration = 60; // PDF render is CPU-bound; give it room

export async function GET(req: Request) {
  // Observability: capture timing per stage (query / render / total) and
  // any error stack so production runs are debuggable without screenshare.
  // Logs are structured so they're greppable in `vercel logs` JSON mode.
  const t0 = Date.now();
  let ctxOrgId = "unknown";
  let stage: "auth" | "query" | "render" | "respond" = "auth";

  try {
    const ctx = await getCurrentContext();
    ctxOrgId = ctx.organization.id;
    const db = getDb();

    const url = new URL(req.url);
    const rawRange = url.searchParams.get("range");
    const rangeDays = clamp(parseInt(rawRange ?? "60", 10) || 60, 7, 365);

    // Pull active deadlines: anything not yet completed AND due within the
    // window (or already overdue). We deliberately include `extension_due_date`
    // via COALESCE so an extended deadline shows on its NEW date.
    stage = "query";
    const tQuery = Date.now();
    const rows = await db.execute<{
    id: string;
    due_date: string;
    effective_due_date: string;
    status: string;
    form_code: string;
    rule_title: string;
    jurisdiction_code: string;
    irrevocable: boolean;
    client_name: string;
    entity_name: string;
    entity_type: string;
    home_state: string | null;
    notes: string | null;
  }>(sql`
    SELECT
      di.id,
      di.due_date::text AS due_date,
      COALESCE(di.extension_due_date, di.due_date)::text AS effective_due_date,
      di.status::text AS status,
      r.form_code,
      r.title AS rule_title,
      r.jurisdiction_code,
      r.irrevocable,
      c.name AS client_name,
      e.name AS entity_name,
      e.entity_type::text AS entity_type,
      e.home_state,
      di.notes
    FROM deadline_instances di
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    WHERE di.org_id = ${ctx.organization.id}
      AND e.archived_at IS NULL
      AND c.archived_at IS NULL
      AND (
        di.status IN ('pending', 'in_progress', 'extended')
        OR di.completed_at >= NOW() - INTERVAL '7 days'
      )
      AND COALESCE(di.extension_due_date, di.due_date)
          <= (CURRENT_DATE + (${rangeDays}::int * INTERVAL '1 day'))
    ORDER BY effective_due_date ASC, c.name ASC
  `);

    const queryMs = Date.now() - tQuery;

    const deadlines: ReportDeadline[] = rows.rows.map((r) => ({
      id: r.id,
      effectiveDueDate: r.effective_due_date,
      originalDueDate: r.due_date,
      status: r.status as ReportDeadline["status"],
      formCode: r.form_code,
      ruleTitle: r.rule_title,
      jurisdictionCode: r.jurisdiction_code,
      irrevocable: r.irrevocable,
      clientName: r.client_name,
      entityName: r.entity_name,
      entityType: r.entity_type,
      homeState: r.home_state,
      notes: r.notes,
    }));

    stage = "render";
    const tRender = Date.now();
    const now = new Date();
    const buffer = await renderToBuffer(
      DeadlineReport({
        orgName: ctx.organization.name,
        generatedAt: now,
        asOf: now,
        rangeDays,
        deadlines,
      }),
    );
    const renderMs = Date.now() - tRender;

    stage = "respond";
    // Filename is human-friendly + cache-busting (date stamp in name).
    const stamp = now.toISOString().slice(0, 10);
    const safeOrg = ctx.organization.name
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .toLowerCase();
    const filename = `${safeOrg || "duedatehq"}-deadlines-${stamp}.pdf`;

    const totalMs = Date.now() - t0;
    console.log(
      `[export/deadlines.pdf] org=${ctxOrgId} range=${rangeDays}d rows=${deadlines.length} bytes=${buffer.length} query_ms=${queryMs} render_ms=${renderMs} total_ms=${totalMs}`,
    );

    // Convert Buffer → ArrayBuffer for a Web-API-compatible Response body.
    // Buffer is a subclass of Uint8Array; Response accepts ArrayBufferLike.
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const totalMs = Date.now() - t0;
    console.error(
      `[export/deadlines.pdf] FAILED stage=${stage} org=${ctxOrgId} total_ms=${totalMs} error=${message}`,
      e,
    );
    return new Response(
      JSON.stringify({ error: "Failed to generate PDF", stage }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
