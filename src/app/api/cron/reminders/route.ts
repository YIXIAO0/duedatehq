/**
 * Daily reminder cron — hit by Vercel Cron at 06:00 UTC every day.
 *
 * Scans upcoming deadlines at 30 / 14 / 3 / 1 day offsets and sends email
 * reminders via Resend. Dedupes by (deadline_instance_id, days_before_due).
 *
 * Protected by CRON_SECRET — Vercel Cron sets the `Authorization` header.
 * https://vercel.com/docs/cron-jobs#securing-cron-jobs
 */

import { NextResponse } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: Request) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>`
  const auth = req.headers.get("authorization");
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // V1: this is a stub. Once DB is provisioned + seed data loaded, this will:
  //   1. Query deadline_instances where due_date ∈ { today+30, today+14, today+3, today+1 }
  //   2. LEFT JOIN reminders_sent to skip already-sent combos
  //   3. Group by org_id → user email lookup
  //   4. Send batched email via Resend
  //   5. Insert reminders_sent rows + audit events
  //
  // For today, just emit a heartbeat the Vercel dashboard can see.
  const now = new Date().toISOString();
  console.log(`[cron/reminders] tick at ${now}`);

  return NextResponse.json({
    ok: true,
    timestamp: now,
    status: "stub — DB not yet seeded",
  });
}
