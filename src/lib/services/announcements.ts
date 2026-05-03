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
import { hasClients } from "./clients";

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
    affected_form_codes: string[];
    original_deadline_start: string | null;
    original_deadline_end: string | null;
    relief_deadline: string | null;
    affected_counties: string[];
    affected_clients: AffectedClient[] | null;
    acked_client_count: number;
  }>(sql`
    SELECT
      a.id, a.source, a.external_id, a.title, a.summary, a.url,
      a.published_at, a.category, a.affected_jurisdictions,
      a.relevance_score, a.ai_summary, a.created_at,
      a.affected_form_codes,
      a.original_deadline_start,
      a.original_deadline_end,
      a.relief_deadline,
      a.affected_counties,
      -- Affected clients = those whose entities are in a matched
      -- jurisdiction AND who actually have a deadline that matches
      -- the announcement's AI-extracted scope (form codes + date
      -- window). When the announcement has no AI scope, we fall
      -- back to the coarse state-only match.
      --
      -- Why this matters: the dashboard bell uses this list as
      -- "is this announcement worth showing?" — when an FL hurricane
      -- has AI scope=[1120, 1120-S], a CPA whose only FL clients
      -- are individuals (no 1120) shouldn't be alarmed.
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
            AND a.affected_jurisdictions ? e.home_state
            AND (
              -- No structured filters → coarse state-only match
              (
                jsonb_array_length(a.affected_form_codes) = 0
                AND a.original_deadline_start IS NULL
              )
              OR
              -- Otherwise: there must exist at least one open
              -- deadline that matches the structured scope.
              EXISTS (
                SELECT 1 FROM deadline_instances di
                INNER JOIN entities e2 ON e2.id = di.entity_id
                INNER JOIN deadline_rules r ON r.id = di.rule_id
                WHERE e2.client_id = c.id
                  AND e2.archived_at IS NULL
                  AND di.completed_at IS NULL
                  AND (
                    jsonb_array_length(a.affected_form_codes) = 0
                    OR a.affected_form_codes ? r.form_code
                  )
                  AND (
                    a.original_deadline_start IS NULL
                    OR a.original_deadline_end IS NULL
                    OR COALESCE(di.extension_due_date, di.due_date)
                       BETWEEN a.original_deadline_start::date
                       AND     a.original_deadline_end::date
                  )
              )
            )
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
    affectedFormCodes: r.affected_form_codes ?? [],
    originalDeadlineStart: r.original_deadline_start,
    originalDeadlineEnd: r.original_deadline_end,
    reliefDeadline: r.relief_deadline,
    affectedCounties: r.affected_counties ?? [],
    affectedClients: r.affected_clients ?? [],
    ackedClientCount: Number(r.acked_client_count ?? 0),
  }));
}

export type DashboardAnnouncementSummary = {
  /**
   * Active high-priority items in the last 30 days (score >= 4, after
   * dismissals and the same org-impact filter the /announcements page
   * applies). Drives the sidebar badge — and the 30-day window matches
   * the page's "High priority — last 30 days" section so the badge
   * count never disagrees with what the user sees when they click in.
   */
  highRelevance30d: number;
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
  orgId?: string,
): Promise<DashboardAnnouncementSummary> {
  const db = getDb();

  // Zero-state gate: if the org has no clients yet, the entire tax-updates
  // surface is suppressed. The feature exists to flag changes affecting
  // your client portfolio — without a portfolio, even score-5 federal
  // disaster items are just newsroom noise. As soon as the first client
  // is added, the normal impact filter takes over and items reappear.
  if (orgId && !(await hasClients(orgId))) {
    return { highRelevance30d: 0, total30d: 0, topRecent: null };
  }

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

  // Match /announcements page's visibility rule exactly. A score-4 item
  // is only counted when at least one of the org's clients actually
  // appears in the announcement's `affectedClients` set — i.e. there's
  // an entity whose home_state matches the announcement's jurisdictions
  // AND (no structured form/date scope, OR there's an open deadline that
  // satisfies it). Score-5 items always count — they show on the page
  // regardless of client match.
  //
  // Earlier versions of this filter passed any item with `'federal'` in
  // `affected_jurisdictions` (or an empty list), which over-counted: the
  // page treats `affected_jurisdictions: ['federal']` as "no client
  // match" because no entity has home_state="federal". That made the
  // badge say "2" while the page showed 1.
  const orgImpactFilter = orgId
    ? sql`AND (
        relevance_score >= 5
        OR EXISTS (
          SELECT 1 FROM clients c
          INNER JOIN entities e ON e.client_id = c.id
          WHERE c.org_id = ${orgId}
            AND c.archived_at IS NULL
            AND e.archived_at IS NULL
            AND e.home_state IS NOT NULL
            AND announcements.affected_jurisdictions ? e.home_state
            AND (
              (
                jsonb_array_length(announcements.affected_form_codes) = 0
                AND announcements.original_deadline_start IS NULL
              )
              OR EXISTS (
                SELECT 1 FROM deadline_instances di
                INNER JOIN entities e2 ON e2.id = di.entity_id
                INNER JOIN deadline_rules r ON r.id = di.rule_id
                WHERE e2.client_id = c.id
                  AND e2.archived_at IS NULL
                  AND di.completed_at IS NULL
                  AND (
                    jsonb_array_length(announcements.affected_form_codes) = 0
                    OR announcements.affected_form_codes ? r.form_code
                  )
                  AND (
                    announcements.original_deadline_start IS NULL
                    OR announcements.original_deadline_end IS NULL
                    OR COALESCE(di.extension_due_date, di.due_date)
                       BETWEEN announcements.original_deadline_start::date
                       AND     announcements.original_deadline_end::date
                  )
              )
            )
        )
      )`
    : sql``;

  const stats = await db.execute<{
    high_30d: number;
    total_30d: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE relevance_score >= 4
          AND published_at >= NOW() - INTERVAL '30 days'
          ${dismissFilter}
          ${orgImpactFilter}
      )::int AS high_30d,
      COUNT(*) FILTER (
        WHERE published_at >= NOW() - INTERVAL '30 days'
          ${dismissFilter}
      )::int AS total_30d
    FROM announcements
  `);

  const highRelevance30d = Number(stats.rows[0]?.high_30d ?? 0);
  const total30d = Number(stats.rows[0]?.total_30d ?? 0);

  let topRecent: Announcement | null = null;
  if (highRelevance30d > 0) {
    const conditions = [
      gte(announcements.relevanceScore, 4),
      gte(
        announcements.publishedAt,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
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

  return { highRelevance30d, total30d, topRecent };
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

/**
 * One affected deadline for an announcement. Drilling into rows
 * lets the review page show specific work, not just a count, and
 * lets the CPA take inline action (e.g. file extension to the
 * relief date with one click).
 */
export type AffectedDeadline = {
  deadlineId: string;
  formCode: string;
  ruleTitle: string;
  /** Original statutory due date — the underlying deadline that the
   *  announcement actually addresses ("the Apr 15 deadline"). */
  originalDueDate: string;
  /** Currently operative date — extension when present, otherwise
   *  original. Shown in the UI alongside originalDueDate so the CPA
   *  sees both "was Apr 15 (extended to Oct 15)" if applicable. */
  currentEffectiveDate: string;
  isFiled: boolean;
  /** Already acted on for this announcement? Persisted in audit_events
   *  so we know whether the relief was already applied or skipped. */
  appliedAt: string | null;
  /** Was the existing extension date already at-or-after the relief
   *  date? When true, no action is needed — the deadline is already
   *  past the relief date (e.g. CPA filed a longer extension already). */
  alreadyCovered: boolean;
};

export type ReviewableClient = {
  clientId: string;
  clientName: string;
  primaryContactEmail: string | null;
  matchedStates: string[]; // which of the client's entity states matched
  /** Total open deadlines (any kind) for this client — context only. */
  openDeadlineCount: number;
  /**
   * The actual deadlines that match this announcement's scope.
   * Empty when the announcement has no structured filters and we
   * can't confidently say which deadlines are affected.
   *
   * Each row is the unit of work the CPA reviews — apply the relief
   * date, mark as skipped, etc.
   */
  affectedDeadlines: AffectedDeadline[];
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
  const formCodesJsonb = JSON.stringify(ann.affectedFormCodes ?? []);
  const dateRangeStart = ann.originalDeadlineStart;
  const dateRangeEnd = ann.originalDeadlineEnd;

  // Two epistemic states matter here:
  //
  //   1. AI extracted SOMETHING — at least form codes or a date range.
  //      We're confident enough to drill into specific deadlines.
  //
  //   2. AI extracted NOTHING — form codes empty AND no date range.
  //      We're not confident. Returning the union of all open
  //      deadlines for the state-matched clients (the previous
  //      behavior) is misleading: a "112 deadlines affected" header
  //      for an Apr 15 announcement is not honest. Don't pretend.
  //
  //      In this case we still surface the affected clients (state
  //      match), but the per-client deadline list comes back empty
  //      and the UI falls through to a client-level checklist.
  const hasNarrowingFilter =
    (ann.affectedFormCodes ?? []).length > 0 ||
    (dateRangeStart != null && dateRangeEnd != null);

  // Even when AI extracted form codes but missed the date range,
  // unbounded form-only matching pulls in 2027/2028 deadlines which
  // can't possibly relate to a 2026-published announcement. Cap to
  // a sane horizon: 30 days before publish (recently overdue) to
  // 180 days after (the immediate filing window). When AI gave us
  // an explicit date range we use that instead — the AI-stated
  // window is more authoritative than our heuristic.
  const publishedAt = ann.publishedAt
    ? new Date(ann.publishedAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Pull rows + the JSONB-aggregated affected-deadlines list so we can
  // render specific work units in the UI. Returning the deadlines
  // directly (vs. just a count) lets the review page show "Acme Corp ·
  // Form 1120 · Oct 15 → Feb 3" with an inline Apply button. The
  // appliedAt is computed via a LATERAL subquery against audit_events
  // so we can show "already applied" state.
  const rows = await db.execute<{
    client_id: string;
    client_name: string;
    primary_contact_email: string | null;
    matched_states: string[];
    open_deadline_count: number;
    affected_deadlines: Array<{
      deadline_id: string;
      form_code: string;
      rule_title: string;
      original_due_date: string;
      current_effective_date: string;
      is_filed: boolean;
      applied_at: string | null;
      already_covered: boolean;
    }> | null;
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
      -- Total open (any kind) for context — same definition as the
      -- /clients list and /clients/[id] detail page (no artificial
      -- future-horizon cap). Shown when no affected deadlines so the
      -- CPA can still tell something exists for this client.
      (
        SELECT COUNT(*)::int
        FROM deadline_instances di
        INNER JOIN entities e2 ON e2.id = di.entity_id
        WHERE e2.client_id = c.id
          AND e2.archived_at IS NULL
          AND di.completed_at IS NULL
      ) AS open_deadline_count,
      -- Affected deadlines list. Only populated when AI narrowed the
      -- scope — without a form-code filter or a date range we don't
      -- know what's actually affected, and listing every open deadline
      -- is misleading. The UI falls back to a client-level checklist
      -- in that case.
      ${
        hasNarrowingFilter
          ? sql`COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'deadline_id', di.id,
              'form_code', r.form_code,
              'rule_title', r.title,
              'current_effective_date',
                COALESCE(di.extension_due_date, di.due_date)::text,
              'original_due_date', di.due_date::text,
              'is_filed', (di.completed_at IS NOT NULL),
              'applied_at', applied.acted_at,
              'already_covered',
                ${
                  ann.reliefDeadline
                    ? sql`(di.extension_due_date IS NOT NULL
                           AND di.extension_due_date >= ${ann.reliefDeadline}::date)`
                    : sql`false`
                }
            )
            ORDER BY di.due_date ASC, r.form_code ASC
          )
          FROM deadline_instances di
          INNER JOIN entities e3 ON e3.id = di.entity_id
          INNER JOIN deadline_rules r ON r.id = di.rule_id
          LEFT JOIN LATERAL (
            SELECT ae.occurred_at::text AS acted_at
            FROM audit_events ae
            WHERE ae.action = 'announcement.relief_applied'
              AND ae.target_id = di.id
              AND (ae.payload->>'announcementId') = ${announcementId}
              AND (ae.actor_id = ${userId} OR ae.actor_id IS NULL)
            ORDER BY ae.occurred_at DESC
            LIMIT 1
          ) applied ON true
          WHERE e3.client_id = c.id
            AND e3.archived_at IS NULL
            AND di.completed_at IS NULL
            AND (
              jsonb_array_length((${formCodesJsonb}::jsonb)) = 0
              OR (${formCodesJsonb}::jsonb) ? r.form_code
            )
            -- Date filter on di.due_date (the ORIGINAL statutory date)
            -- — not the effective date. The announcement says "the
            -- April 15 deadline" referring to the underlying statutory
            -- obligation; a 1040 originally due Apr 15 still counts
            -- even if the CPA already extended it to Oct 15 via Form
            -- 4868. And a 1040 due Apr 15, 2027 is a different
            -- deadline than Apr 15, 2026 — matching only by year-
            -- agnostic "form code" would over-include future years.
            ${
              dateRangeStart && dateRangeEnd
                ? sql`AND di.due_date
                        BETWEEN ${dateRangeStart}::date AND ${dateRangeEnd}::date`
                : sql`AND di.due_date
                        BETWEEN (${publishedAt}::date - INTERVAL '30 days')
                        AND     (${publishedAt}::date + INTERVAL '180 days')`
            }
        ),
        '[]'::jsonb
      )`
          : sql`'[]'::jsonb`
      } AS affected_deadlines,
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

  // hasNarrowingFilter is computed up top — reuse it here. When AI
  // narrowed the scope and a client's affectedDeadlines came back
  // empty, drop them: they're in the affected state but have nothing
  // actually in scope. When AI didn't narrow, keep all coarse-matched
  // clients (we have nothing better to filter by).
  const clients = rows.rows
    .map((r) => ({
      clientId: r.client_id,
      clientName: r.client_name,
      primaryContactEmail: r.primary_contact_email,
      matchedStates: r.matched_states ?? [],
      openDeadlineCount: Number(r.open_deadline_count ?? 0),
      affectedDeadlines: (r.affected_deadlines ?? []).map((d) => ({
        deadlineId: d.deadline_id,
        formCode: d.form_code,
        ruleTitle: d.rule_title,
        originalDueDate: d.original_due_date,
        currentEffectiveDate: d.current_effective_date,
        isFiled: Boolean(d.is_filed),
        appliedAt: d.applied_at,
        alreadyCovered: Boolean(d.already_covered),
      })),
      acked: Boolean(r.acked),
    }))
    // When the announcement has structured filters, exclude clients
    // whose affectedDeadlines list came back empty — they're in the
    // affected state but have no deadlines that actually fall in
    // scope. When no filters, keep all coarse-matched clients.
    .filter((c) => !hasNarrowingFilter || c.affectedDeadlines.length > 0);

  return {
    announcement: ann,
    clients,
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
