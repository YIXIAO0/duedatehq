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
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  announcements,
  announcementClientAcks,
  announcementDismissals,
  type Announcement,
} from "@/lib/db/schema";

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
  /**
   * If a userId is passed, items dismissed by that user are filtered out
   * unless `showDismissed` flips the polarity to "dismissed-only" (used
   * for the "Show dismissed" toggle on /announcements).
   */
  userId: z.string().optional(),
  showDismissed: z.boolean().default(false),
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
  // Per-user dismiss filter — see comment on the WithImpact variant.
  if (parsed.userId) {
    if (parsed.showDismissed) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM announcement_dismissals d
        WHERE d.announcement_id = ${announcements.id}
          AND d.user_id = ${parsed.userId}
      )`);
    } else {
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM announcement_dismissals d
        WHERE d.announcement_id = ${announcements.id}
          AND d.user_id = ${parsed.userId}
      )`);
    }
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
  /**
   * How many of `affectedClients` the calling user has already reviewed.
   * Only populated when a userId is supplied (otherwise 0). Lets the
   * dashboard show "2 of 7 reviewed" and surface unfinished items first.
   */
  ackedClientCount: number;
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

  // Per-user dismiss filter. When a userId is supplied:
  //   - default: hide items this user has dismissed (the common case)
  //   - showDismissed=true: invert — show only dismissed items, used by
  //     the "Show dismissed" toggle on /announcements as a recovery path
  // When no userId, no filter applies (the cron / agent contexts).
  const dismissFilter = parsed.userId
    ? parsed.showDismissed
      ? sql`AND EXISTS (
          SELECT 1 FROM announcement_dismissals d
          WHERE d.announcement_id = a.id AND d.user_id = ${parsed.userId}
        )`
      : sql`AND NOT EXISTS (
          SELECT 1 FROM announcement_dismissals d
          WHERE d.announcement_id = a.id AND d.user_id = ${parsed.userId}
        )`
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
    acked_client_count: number;
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
      ) AS affected_clients,
      ${
        parsed.userId
          ? sql`(
              SELECT COUNT(*)::int
              FROM announcement_client_acks ack
              INNER JOIN clients c2 ON c2.id = ack.client_id
              WHERE ack.announcement_id = a.id
                AND ack.user_id = ${parsed.userId}
                AND c2.org_id = ${orgId}
                AND c2.archived_at IS NULL
            )`
          : sql`0`
      } AS acked_client_count
    FROM announcements a
    WHERE a.relevance_score >= ${parsed.minScore}
      ${sinceFilter}
      ${categoryFilter}
      ${dismissFilter}
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
    ackedClientCount: Number(r.acked_client_count ?? 0),
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
 * One-shot summary for the header badge. Single round-trip.
 *
 * Respects per-user dismissals when a userId is provided so the badge
 * count drops to zero once the CPA has dismissed everything they care
 * about. Without a userId we count globally (used in older callers).
 */
export async function getAnnouncementsSummary(
  userId?: string,
): Promise<DashboardAnnouncementSummary> {
  const db = getDb();

  // When userId is set, exclude this user's dismissed items from BOTH
  // the high-7d and total-30d counts so the header badge can return
  // to zero. Implemented as a NOT EXISTS subquery in the FILTER clause.
  const dismissFilter = userId
    ? sql`AND NOT EXISTS (
        SELECT 1 FROM announcement_dismissals d
        WHERE d.announcement_id = announcements.id
          AND d.user_id = ${userId}
      )`
    : sql``;

  const stats = await db.execute<{
    high_7d: number;
    total_30d: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE relevance_score >= 4
          AND published_at >= NOW() - INTERVAL '7 days'
          ${dismissFilter}
      )::int AS high_7d,
      COUNT(*) FILTER (
        WHERE published_at >= NOW() - INTERVAL '30 days'
          ${dismissFilter}
      )::int AS total_30d
    FROM announcements
  `);

  const highRelevance7d = Number(stats.rows[0]?.high_7d ?? 0);
  const total30d = Number(stats.rows[0]?.total_30d ?? 0);

  let topRecent: Announcement | null = null;
  if (highRelevance7d > 0) {
    const conditions = [
      gte(announcements.relevanceScore, 4),
      gte(
        announcements.publishedAt,
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      ),
    ];
    if (userId) {
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM announcement_dismissals d
        WHERE d.announcement_id = ${announcements.id}
          AND d.user_id = ${userId}
      )`);
    }
    const rows = await db
      .select()
      .from(announcements)
      .where(and(...conditions))
      .orderBy(desc(announcements.publishedAt))
      .limit(1);
    topRecent = rows[0] ?? null;
  }

  return { highRelevance7d, total30d, topRecent };
}

// ---------------------------------------------------------------------------
// Dismiss / un-dismiss
//
// Pure ON CONFLICT DO NOTHING / DELETE — no validation of relevance score
// or category. The user gets to choose what's noise, even if our rubric
// disagrees. The unique index on (user_id, announcement_id) makes both
// operations safely idempotent.
// ---------------------------------------------------------------------------

export async function dismissAnnouncement(
  userId: string,
  announcementId: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(announcementDismissals)
    .values({ userId, announcementId })
    .onConflictDoNothing();
}

export async function undismissAnnouncement(
  userId: string,
  announcementId: string,
): Promise<void> {
  const db = getDb();
  await db
    .delete(announcementDismissals)
    .where(
      and(
        eq(announcementDismissals.userId, userId),
        eq(announcementDismissals.announcementId, announcementId),
      ),
    );
}

/** Count of items this user has dismissed (used for "Show dismissed" toggle). */
export async function countDismissedAnnouncements(
  userId: string,
): Promise<number> {
  const db = getDb();
  const r = await db.execute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n
    FROM announcement_dismissals
    WHERE user_id = ${userId}
  `);
  return Number(r.rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Per-announcement client checklist — the deadline-centric view.
//
// Given an announcement id + the calling user, returns:
//   - the announcement itself
//   - every client in the org whose home_state intersects the announcement's
//     affected_jurisdictions
//   - for each client, the open deadlines (pending / in_progress / extended)
//     that fall in the relevant tax window — these are the ones the CPA
//     might need to act on
//   - whether the calling user has already marked this (announcement, client)
//     pair as reviewed
//
// One round-trip via two queries (announcement + client list with embedded
// deadline list as jsonb), then a join with the ack table.
// ---------------------------------------------------------------------------

export type ReviewableClient = {
  clientId: string;
  clientName: string;
  primaryContactEmail: string | null;
  matchedStates: string[]; // which of the client's entity states matched
  /**
   * Total open deadlines for this client (pending/in_progress/extended).
   * Just a context number — we deliberately don't list them inline because
   * we can't reliably narrow to the ones the announcement actually affects
   * without structured AI date/form extraction (V2). Showing all of them
   * was noisy and falsely implied "these are the affected ones".
   */
  openDeadlineCount: number;
  acked: boolean;
};

export type AnnouncementReview = {
  announcement: Announcement;
  clients: ReviewableClient[];
};

export async function getAnnouncementReview(
  announcementId: string,
  orgId: string,
  userId: string,
): Promise<AnnouncementReview | null> {
  const db = getDb();

  // 1. The announcement itself.
  const annRows = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, announcementId))
    .limit(1);
  const ann = annRows[0];
  if (!ann) return null;

  // 2. Affected clients with embedded open-deadlines list. The
  //    LATERAL subquery aggregates each client's deadlines into a jsonb
  //    array so we don't N+1. Open = pending/in_progress/extended; we
  //    skip completed/missed because they can't be acted on anymore.
  //
  //    We also LEFT JOIN announcement_client_acks for the calling user so
  //    each row carries its own "acked?" flag.
  //
  //    NB: pre-stringified jsonb literal — Drizzle binds JS arrays as
  //    raw params without a type, so `${array} @> ...` makes Postgres
  //    treat it as text and the `@>` operator fails to resolve. Explicit
  //    `::jsonb` cast on a JSON-string literal is the reliable shape.
  const affectedJsonb = JSON.stringify(ann.affectedJurisdictions ?? []);
  const rows = await db.execute<{
    client_id: string;
    client_name: string;
    primary_contact_email: string | null;
    matched_states: string[];
    open_deadline_count: number;
    acked: boolean;
  }>(sql`
    SELECT
      c.id AS client_id,
      c.name AS client_name,
      c.primary_contact_email,
      ARRAY(
        SELECT DISTINCT e.home_state
        FROM entities e
        WHERE e.client_id = c.id
          AND e.archived_at IS NULL
          AND e.home_state IS NOT NULL
          AND (${affectedJsonb}::jsonb) ? e.home_state
      ) AS matched_states,
      -- Just the count; we deliberately don't list deadlines inline
      -- because we can't yet reliably scope them to the announcement
      -- (no AI-extracted dates/forms). Showing all of them implied
      -- "these are the affected deadlines" which was misleading.
      (
        SELECT COUNT(*)::int
        FROM deadline_instances di
        INNER JOIN entities e2 ON e2.id = di.entity_id
        WHERE e2.client_id = c.id
          AND e2.archived_at IS NULL
          AND di.status IN ('pending', 'in_progress', 'extended')
      ) AS open_deadline_count,
      EXISTS (
        SELECT 1 FROM announcement_client_acks ack
        WHERE ack.announcement_id = ${announcementId}
          AND ack.client_id = c.id
          AND ack.user_id = ${userId}
      ) AS acked
    FROM clients c
    WHERE c.org_id = ${orgId}
      AND c.archived_at IS NULL
      AND EXISTS (
        SELECT 1 FROM entities e
        WHERE e.client_id = c.id
          AND e.archived_at IS NULL
          AND e.home_state IS NOT NULL
          AND (${affectedJsonb}::jsonb) ? e.home_state
      )
    ORDER BY acked ASC, c.name ASC
  `);

  return {
    announcement: ann,
    clients: rows.rows.map((r) => ({
      clientId: r.client_id,
      clientName: r.client_name,
      primaryContactEmail: r.primary_contact_email,
      matchedStates: r.matched_states ?? [],
      openDeadlineCount: Number(r.open_deadline_count ?? 0),
      acked: Boolean(r.acked),
    })),
  };
}

/**
 * Mark this (announcement, client) pair as reviewed for the calling user.
 * Idempotent — repeat clicks ON CONFLICT DO NOTHING.
 */
export async function ackClientForAnnouncement(args: {
  userId: string;
  announcementId: string;
  clientId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(announcementClientAcks)
    .values(args)
    .onConflictDoNothing();
}

export async function unackClientForAnnouncement(args: {
  userId: string;
  announcementId: string;
  clientId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .delete(announcementClientAcks)
    .where(
      and(
        eq(announcementClientAcks.userId, args.userId),
        eq(announcementClientAcks.announcementId, args.announcementId),
        eq(announcementClientAcks.clientId, args.clientId),
      ),
    );
}
