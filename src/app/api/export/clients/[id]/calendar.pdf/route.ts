/**
 * Per-client tax calendar PDF — the document a CPA emails or hands to a
 * single client annually. Different shape from the firm-wide PDF:
 *   - Scoped to one client_id (rejects cross-client / cross-org access)
 *   - Forward-looking only, no status info, no internal notes
 *   - Plain-English form names ("Personal income tax return" not "1040")
 *   - The CPA firm's name is the brand, not DueDateHQ
 *
 * Query params:
 *   ?taxYear=2026   default = current calendar year
 *
 * Auth: Clerk via getCurrentContext (same as CSV/PDF firm export). The
 * client_id MUST belong to the current org — we re-verify in the SQL.
 */

import { sql } from "drizzle-orm";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";
import {
  ClientCalendar,
  type CalendarDeadline,
  type CalendarEntity,
} from "@/lib/pdf/client-calendar";

// Cache Components forbids per-route runtime; Node.js is the default and
// is what we need for Buffer + react-pdf streams.
export const maxDuration = 60;

type Params = Promise<{ id: string }>;

export async function GET(req: Request, { params }: { params: Params }) {
  const t0 = Date.now();
  let stage: "auth" | "client" | "query" | "render" | "respond" = "auth";
  let orgId = "unknown";
  let clientId = "unknown";

  try {
    const ctx = await getCurrentContext();
    orgId = ctx.organization.id;
    const { id } = await params;
    clientId = id;
    const db = getDb();

    const url = new URL(req.url);
    const taxYearRaw = url.searchParams.get("taxYear");
    const currentYear = new Date().getUTCFullYear();
    const taxYear = clamp(
      parseInt(taxYearRaw ?? String(currentYear), 10) || currentYear,
      currentYear - 5,
      currentYear + 2,
    );

    // 1. Verify the client belongs to the org. One query also gets us
    //    the client name for the cover.
    stage = "client";
    const clientRows = await db.execute<{
      id: string;
      name: string;
    }>(sql`
      SELECT id, name
      FROM clients
      WHERE id = ${clientId}
        AND org_id = ${orgId}
        AND archived_at IS NULL
      LIMIT 1
    `);
    const client = clientRows.rows[0];
    if (!client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2. Pull the entities + deadlines for the requested tax year.
    //    One round-trip each — at the per-client scale these are tiny.
    stage = "query";
    const tQuery = Date.now();
    const entityRows = await db.execute<CalendarEntity>(sql`
      SELECT id, name, entity_type::text AS "entityType", home_state AS "homeState"
      FROM entities
      WHERE client_id = ${clientId}
        AND org_id = ${orgId}
        AND archived_at IS NULL
      ORDER BY name ASC
    `);

    const deadlineRows = await db.execute<{
      id: string;
      entity_id: string;
      due_date: string;
      form_code: string;
      rule_title: string;
      jurisdiction_code: string;
      irrevocable: boolean;
      penalty_summary: string | null;
    }>(sql`
      SELECT
        di.id,
        di.entity_id,
        di.due_date::text AS due_date,
        r.form_code,
        r.title AS rule_title,
        r.jurisdiction_code,
        r.irrevocable,
        r.penalty_summary
      FROM deadline_instances di
      INNER JOIN deadline_rules r ON r.id = di.rule_id
      INNER JOIN entities e ON e.id = di.entity_id
      WHERE e.client_id = ${clientId}
        AND di.org_id = ${orgId}
        AND di.tax_year = ${taxYear}
        AND e.archived_at IS NULL
      ORDER BY di.due_date ASC
    `);
    const queryMs = Date.now() - tQuery;

    const deadlines: CalendarDeadline[] = deadlineRows.rows.map((r) => ({
      id: r.id,
      entityId: r.entity_id,
      dueDate: r.due_date,
      formCode: r.form_code,
      ruleTitle: r.rule_title,
      jurisdictionCode: r.jurisdiction_code,
      irrevocable: r.irrevocable,
      penaltySummary: r.penalty_summary,
    }));

    // 3. Render.
    stage = "render";
    const tRender = Date.now();
    const now = new Date();
    const buffer = await renderToBuffer(
      ClientCalendar({
        clientName: client.name,
        orgName: ctx.organization.name,
        preparerEmail: ctx.email,
        preparerName: ctx.user.fullName ?? null,
        taxYear,
        generatedAt: now,
        entities: entityRows.rows,
        deadlines,
      }),
    );
    const renderMs = Date.now() - tRender;

    // 4. Respond.
    stage = "respond";
    const safeClient = client.name
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .toLowerCase();
    const filename = `${safeClient || "client"}-tax-calendar-${taxYear}.pdf`;

    const totalMs = Date.now() - t0;
    console.log(
      `[export/client-calendar] org=${orgId} client=${clientId} taxYear=${taxYear} entities=${entityRows.rows.length} deadlines=${deadlines.length} bytes=${buffer.length} query_ms=${queryMs} render_ms=${renderMs} total_ms=${totalMs}`,
    );

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
      `[export/client-calendar] FAILED stage=${stage} org=${orgId} client=${clientId} total_ms=${totalMs} error=${message}`,
      e,
    );
    return new Response(
      JSON.stringify({ error: "Failed to generate calendar", stage }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
