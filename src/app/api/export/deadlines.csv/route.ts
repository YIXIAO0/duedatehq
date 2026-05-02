/**
 * CSV export of all active deadlines for the current org.
 *
 * Columns chosen for maximum portability — easily re-imported to Excel,
 * shared with a client, or fed into a workflow tool.
 */

import { sql } from "drizzle-orm";
import { getCurrentContext } from "@/lib/auth/current-org";
import { getDb } from "@/lib/db";

export async function GET() {
  const start = Date.now();
  try {
    const ctx = await getCurrentContext();
    const db = getDb();

    const rows = await db.execute<{
    due_date: string;
    effective_due_date: string;
    completed_at: string | null;
    tax_year: number;
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
      di.due_date,
      COALESCE(di.extension_due_date, di.due_date) AS effective_due_date,
      di.completed_at::text AS completed_at,
      di.tax_year,
      r.form_code,
      r.title AS rule_title,
      r.jurisdiction_code,
      r.irrevocable,
      c.name AS client_name,
      e.name AS entity_name,
      e.entity_type,
      e.home_state,
      di.notes
    FROM deadline_instances di
    INNER JOIN deadline_rules r ON r.id = di.rule_id
    INNER JOIN entities e ON e.id = di.entity_id
    INNER JOIN clients c ON c.id = e.client_id
    WHERE di.org_id = ${ctx.organization.id}
      AND e.archived_at IS NULL
      AND c.archived_at IS NULL
    ORDER BY effective_due_date ASC, c.name ASC
  `);

  const headers = [
    "Effective Due Date",
    "Original Due Date",
    "Status",
    "Tax Year",
    "Client",
    "Entity",
    "Entity Type",
    "Home State",
    "Jurisdiction",
    "Form",
    "Title",
    "Irrevocable",
    "Notes",
  ];

  const lines = [headers.join(",")];
  for (const r of rows.rows) {
    lines.push(
      [
        r.effective_due_date,
        r.due_date,
        r.completed_at ? "Filed" : "Pending",
        r.tax_year,
        csvEscape(r.client_name),
        csvEscape(r.entity_name),
        r.entity_type,
        r.home_state ?? "",
        r.jurisdiction_code === "federal" ? "US Federal" : r.jurisdiction_code,
        r.form_code,
        csvEscape(r.rule_title),
        r.irrevocable ? "Yes" : "",
        csvEscape(r.notes ?? ""),
      ].join(","),
    );
  }

    const body = lines.join("\n");
    const today = new Date().toISOString().slice(0, 10);

    console.log(
      `[export/deadlines.csv] org=${ctx.organization.id} rows=${rows.rows.length} ms=${Date.now() - start}`,
    );

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="duedatehq-deadlines-${today}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[export/deadlines.csv] failed: ${message}`);
    return new Response(`Export failed: ${message}`, { status: 500 });
  }
}

/** Escape a CSV field — wrap in quotes if it contains special chars. */
function csvEscape(value: string): string {
  if (value == null || value === "") return "";
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}
