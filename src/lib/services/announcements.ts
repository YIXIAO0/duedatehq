/**
 * Announcement queries — read-only surface over the org-agnostic
 * `announcements` table.
 *
 * Two main consumers right now:
 *   - <DashboardAnnouncementBanner/>: needs a count of "high relevance,
 *     last 7 days" so it can decide whether to render at all.
 *   - /announcements page: needs the full feed with filtering.
 *
 * Both are read-only — the only writer is the scrape workflow.
 */

import "server-only";
import { z } from "zod";
import { and, desc, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { announcements, type Announcement } from "@/lib/db/schema";

export const ListAnnouncementsInputSchema = z.object({
  /** Only items published in the last N days. 0 = no time floor. */
  sinceDays: z.number().int().min(0).max(365).default(30),
  /** Filter to category, or undefined = all categories. */
  category: z
    .enum(["disaster_relief", "form_change", "procedural", "general"])
    .optional(),
  /** Minimum relevance score (1–5). */
  minScore: z.number().int().min(1).max(5).default(1),
  limit: z.number().int().positive().max(100).default(50),
});
export type ListAnnouncementsInput = z.input<typeof ListAnnouncementsInputSchema>;

export async function listAnnouncements(
  input: ListAnnouncementsInput = {},
): Promise<Announcement[]> {
  const parsed = ListAnnouncementsInputSchema.parse(input);
  const db = getDb();

  const conditions = [
    gte(announcements.relevanceScore, parsed.minScore),
  ];
  if (parsed.sinceDays > 0) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - parsed.sinceDays);
    conditions.push(gte(announcements.publishedAt, since));
  }
  if (parsed.category) {
    conditions.push(sql`${announcements.category} = ${parsed.category}`);
  }

  return db
    .select()
    .from(announcements)
    .where(and(...conditions))
    .orderBy(
      desc(announcements.relevanceScore),
      desc(announcements.publishedAt),
    )
    .limit(parsed.limit);
}

export type DashboardAnnouncementSummary = {
  /** Items in last 7 days with score >= 4. The dashboard banner key. */
  highRelevance7d: number;
  /** Total in last 30 days. Surfaces whether the feed has any signal. */
  total30d: number;
  /** Most recent high-relevance one — used for the banner blurb. */
  topRecent: Announcement | null;
};

/**
 * One-shot summary for the dashboard banner. Single round-trip.
 */
export async function getAnnouncementsSummary(): Promise<DashboardAnnouncementSummary> {
  const db = getDb();

  const stats = await db.execute<{
    high_7d: number;
    total_30d: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE relevance_score >= 4
          AND published_at >= NOW() - INTERVAL '7 days'
      )::int AS high_7d,
      COUNT(*) FILTER (
        WHERE published_at >= NOW() - INTERVAL '30 days'
      )::int AS total_30d
    FROM announcements
  `);

  const highRelevance7d = Number(stats.rows[0]?.high_7d ?? 0);
  const total30d = Number(stats.rows[0]?.total_30d ?? 0);

  let topRecent: Announcement | null = null;
  if (highRelevance7d > 0) {
    const rows = await db
      .select()
      .from(announcements)
      .where(
        and(
          gte(announcements.relevanceScore, 4),
          gte(
            announcements.publishedAt,
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          ),
        ),
      )
      .orderBy(desc(announcements.publishedAt))
      .limit(1);
    topRecent = rows[0] ?? null;
  }

  return { highRelevance7d, total30d, topRecent };
}
