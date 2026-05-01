/**
 * Dashboard deadline list — server-side filtered + paginated.
 *
 * Query params (all optional):
 *   limit=100
 *   offset=0
 *   urgency=all|urgent|irrevocable
 *   jurisdiction=all|federal|CA|NY|...
 *   entityType=all|individual|c_corp|...
 *   status=active|extended_only
 *   q=<free-text>  (ILIKE against client / entity / form_code / rule_title)
 *
 * Response: { rows: DashboardDeadline[], hasMore: boolean }
 * hasMore is `rows.length === limit` — true-positive: there might be more,
 * fetch the next page to know for sure.
 */

import { NextResponse } from "next/server";
import { getCurrentContext } from "@/lib/auth/current-org";
import { listDashboardDeadlines } from "@/lib/services/deadline-engine";

const MAX_LIMIT = 200;

export async function GET(req: Request) {
  const ctx = await getCurrentContext();
  const url = new URL(req.url);

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? 100)),
  );
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

  const urgency = (url.searchParams.get("urgency") ?? "all") as
    | "all"
    | "urgent"
    | "irrevocable";
  const jurisdictionCode = url.searchParams.get("jurisdiction") ?? "all";
  const entityType = url.searchParams.get("entityType") ?? "all";
  const status = (url.searchParams.get("status") ?? "active") as
    | "active"
    | "extended_only";
  // Free-text narrow. Trim and cap so a runaway client can't ship a
  // multi-megabyte param. Empty / whitespace-only treated as "no search".
  const rawQ = url.searchParams.get("q") ?? "";
  const q = rawQ.trim().slice(0, 200);

  try {
    const rows = await listDashboardDeadlines({
      orgId: ctx.organization.id,
      limit,
      offset,
      urgency,
      jurisdictionCode,
      entityType,
      status,
      search: q || undefined,
    });

    return NextResponse.json({
      rows,
      hasMore: rows.length === limit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/deadlines/list]", message);
    return NextResponse.json(
      { rows: [], hasMore: false, error: message },
      { status: 500 },
    );
  }
}
