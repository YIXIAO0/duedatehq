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

// ---------------------------------------------------------------------------
// Announcement × client matching — the moat-deepening feature.
//
// For each announcement, intersect its `affected_jurisdictions` with the
// home_state of the org's active entities. Returns the list of clients
// whose entities sit in any of those states, so the UI can surface
// "Affects 3 of your clients" inline on each row.
//
// "federal" announcements correctly produce zero matches (no entity has
// home_state="federal"), which is the right behavior — "1099-K threshold
// changed" affects everyone equally, no per-client highlight earned.
// State-specific items ("FL hurricane disaster relief") will only
// highlight when the org actually has FL clients.
//
// Composed as a LATERAL subquery to keep this a single round-trip.
// ---------------------------------------------------------------------------

export type AffectedClient = {
  id: string;
  name: string;
};

export type AnnouncementWithImpact = Announcement & {
  affectedClients: AffectedClient[];
};

export async function listAnnouncementsWithImpact(
  orgId: string,
  input: ListAnnouncementsInput = {},
): Promise<AnnouncementWithImpact[]> {
  const parsed = ListAnnouncementsInputSchema.parse(input);
  const db = getDb();

  const sinceFilter =
    parsed.sinceDays > 0
      ? sql`AND a.published_at >= NOW() - (${parsed.sinceDays}::int * INTERVAL '1 day')`
      : sql``;

  const categoryFilter = parsed.category
    ? sql`AND a.category = ${parsed.category}`
    : sql``;

  const rows = await db.execute<{
    id: string;
    source: string;
    external_id: string;
    title: string;
    summary: string | null;
    url: string;
    published_at: Date;
    category: string;
    affected_jurisdictions: string[];
    relevance_score: number;
    ai_summary: string | null;
    created_at: Date;
    affected_clients: AffectedClient[] | null;
  }>(sql`
    SELECT
      a.id, a.source, a.external_id, a.title, a.summary, a.url,
      a.published_at, a.category, a.affected_jurisdictions,
      a.relevance_score, a.ai_summary, a.created_at,
      COALESCE(
        (
          SELECT jsonb_agg(
            DISTINCT jsonb_build_object('id', c.id, 'name', c.name)
          )
          FROM clients c
          INNER JOIN entities e ON e.client_id = c.id
          WHERE c.org_id = ${orgId}
            AND c.archived_at IS NULL
            AND e.archived_at IS NULL
            AND e.home_state IS NOT NULL
            -- jsonb ? string returns true if string is in the jsonb array
            AND a.affected_jurisdictions ? e.home_state
        ),
        '[]'::jsonb
      ) AS affected_clients
    FROM announcements a
    WHERE a.relevance_score >= ${parsed.minScore}
      ${sinceFilter}
      ${categoryFilter}
    ORDER BY a.relevance_score DESC, a.published_at DESC
    LIMIT ${parsed.limit}
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    title: r.title,
    summary: r.summary,
    url: r.url,
    publishedAt: new Date(r.published_at),
    category: r.category,
    affectedJurisdictions: r.affected_jurisdictions ?? [],
    relevanceScore: r.relevance_score,
    aiSummary: r.ai_summary,
    createdAt: new Date(r.created_at),
    affectedClients: r.affected_clients ?? [],
  }));
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
