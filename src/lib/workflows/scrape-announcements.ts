/**
 * Daily IRS Newsroom scrape — the protective moat for DueDateHQ.
 *
 * The whole reason a CPA hires this product instead of writing dates on
 * a whiteboard: we tell them when something changes. Hurricanes, form
 * threshold updates, e-file requirement shifts. CPAs find out about
 * these via tax newsletters or their professional network — slow,
 * sometimes wrong, sometimes too late.
 *
 * This workflow runs every morning before US business hours, pulls
 * the IRS Newsroom RSS, classifies each new item with an LLM, and
 * stores the results. The dashboard shows a small banner when there
 * are unread high-relevance items in the past 7 days.
 *
 * Why Workflow DevKit (not a plain cron)?
 *   1. RSS fetch + 5 LLM classifications is brittle work. Each step
 *      retries on transient errors. A 503 from IRS doesn't poison
 *      the whole run.
 *   2. Step results are persisted, so a partial-failure replay
 *      doesn't burn AI credits re-classifying items we already did.
 *   3. The workflow run page (`vercel workflow web <runId>`) gives
 *      us a visual debugger when something looks off in production.
 *
 * Sandbox notes:
 *   - The workflow function is "use workflow" — orchestration only.
 *     No Node APIs, no fetch (use the workflow.fetch shim if needed).
 *   - All real I/O lives in "use step" functions which have full
 *     Node.js — regular fetch, AI SDK, Drizzle, etc. all work there.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { generateText, Output } from "ai";
import { z } from "zod";
import { FatalError, RetryableError } from "workflow";
import { getDb } from "@/lib/db";
import { announcements, ANNOUNCEMENT_CATEGORIES } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ParsedItem = {
  externalId: string; // RSS GUID — our dedupe anchor
  title: string;
  link: string;
  pubDate: string; // ISO
  description: string;
};

type Classification = z.infer<typeof ClassificationSchema>;

const ClassificationSchema = z.object({
  category: z.enum(ANNOUNCEMENT_CATEGORIES),
  /** ISO state codes ("FL", "TX") or "federal". Empty when unclear. */
  affectedJurisdictions: z.array(z.string().max(8)).max(60),
  /** 1 = trivia, 5 = drop-everything-and-call-clients. */
  relevanceScore: z.number().int().min(1).max(5),
  /** One sentence in CPA-friendly language, ≤ 160 chars. */
  summary: z.string().min(1).max(180),
});

export type ScrapeResult = {
  fetched: number;
  newItems: number;
  classified: number;
  classifyErrors: number;
  storedIds: string[];
};

// ---------------------------------------------------------------------------
// Step 1 — fetch the RSS feed
// ---------------------------------------------------------------------------

async function fetchIrsNewsroomRss(): Promise<string> {
  "use step";
  console.log("[scrape] step=fetchRss start url=irs.gov/newsroom/feed");
  const t0 = Date.now();

  let res: Response;
  try {
    res = await fetch("https://www.irs.gov/newsroom/feed", {
      headers: {
        // Polite UA so IRS knows who's hitting them.
        "user-agent": "DueDateHQ/1.0 (+https://duedatehq.com)",
        accept: "application/rss+xml, application/xml;q=0.9",
      },
    });
  } catch (e) {
    // Network blip → retry. Workflow runtime backs off automatically.
    throw new RetryableError(
      `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 5xx → retry. 4xx → permanent (most likely a URL change we need to fix).
  if (res.status >= 500) {
    throw new RetryableError(`IRS RSS ${res.status}`, { retryAfter: "5m" });
  }
  if (res.status >= 400) {
    throw new FatalError(`IRS RSS ${res.status} — feed URL likely changed`);
  }
  const xml = await res.text();
  console.log(
    `[scrape] step=fetchRss ok bytes=${xml.length} ms=${Date.now() - t0}`,
  );
  return xml;
}

// ---------------------------------------------------------------------------
// Step 2 — parse RSS into items (regex-based; the IRS feed is plain RSS 2.0)
// ---------------------------------------------------------------------------

async function parseRss(xml: string): Promise<ParsedItem[]> {
  "use step";
  console.log("[scrape] step=parseRss start");

  const items: ParsedItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const tag = (s: string, name: string) => {
    // Allow CDATA wrapping
    const re = new RegExp(
      `<${name}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`,
    );
    const m = s.match(re);
    return m ? m[1].trim() : "";
  };

  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = tag(block, "title");
    const link = tag(block, "link");
    const pubDateRaw = tag(block, "pubDate");
    const guid = tag(block, "guid") || link;
    const description = tag(block, "description");

    if (!title || !link || !guid) continue; // skip malformed
    const pubDate = pubDateRaw
      ? new Date(pubDateRaw).toISOString()
      : new Date().toISOString();

    items.push({
      externalId: guid,
      title: decodeEntities(title),
      link,
      pubDate,
      description: decodeEntities(stripHtml(description)).slice(0, 1500),
    });
  }

  console.log(`[scrape] step=parseRss extracted=${items.length}`);
  return items;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ---------------------------------------------------------------------------
// Step 3 — filter to items we haven't stored yet
// ---------------------------------------------------------------------------

async function filterNewItems(items: ParsedItem[]): Promise<ParsedItem[]> {
  "use step";
  console.log(`[scrape] step=filterNew checking=${items.length}`);
  if (items.length === 0) return [];

  const db = getDb();
  const ids = items.map((i) => i.externalId);
  // Postgres has a generous parameter limit; 50 IDs/day is safe.
  const existing = await db.execute<{ external_id: string }>(sql`
    SELECT external_id
    FROM announcements
    WHERE source = 'irs_newsroom'
      AND external_id = ANY(${ids}::text[])
  `);
  const seen = new Set(existing.rows.map((r) => r.external_id));
  const fresh = items.filter((i) => !seen.has(i.externalId));
  console.log(
    `[scrape] step=filterNew fresh=${fresh.length} dupes=${items.length - fresh.length}`,
  );
  return fresh;
}

// ---------------------------------------------------------------------------
// Step 4 — classify a single item with the LLM and INSERT
//
// Per-item step (rather than batch) so a flaky AI call on item #3 doesn't
// force re-classification of items #1 and #2 on retry. Workflow caches
// step results by their position-in-the-orchestration plus arguments.
// ---------------------------------------------------------------------------

async function classifyAndStoreOne(
  item: ParsedItem,
): Promise<{ id: string; classification: Classification }> {
  "use step";
  console.log(
    `[scrape] step=classifyOne start externalId=${item.externalId.slice(-32)}`,
  );
  const t0 = Date.now();

  const { experimental_output: out } = await generateText({
    model: "anthropic/claude-haiku-4.5",
    temperature: 0.2, // facts, not creativity
    experimental_output: Output.object({ schema: ClassificationSchema }),
    system:
      "You are a CPA's research assistant classifying IRS Newsroom announcements. " +
      "Be conservative on relevance. Score 5 only for items that change a real " +
      "deadline or filing requirement (disaster relief, form threshold change, " +
      "e-file mandate). General PR / outreach / op-ed = 1 or 2. " +
      "If a state list isn't explicit, return [\"federal\"] for nationwide items. " +
      "Categories: " +
      ANNOUNCEMENT_CATEGORIES.join(", ") +
      ".",
    prompt: [
      `Title: ${item.title}`,
      `Published: ${item.pubDate}`,
      `URL: ${item.link}`,
      `Excerpt: ${item.description}`,
    ].join("\n"),
  });
  const cls = out;

  const db = getDb();
  // ON CONFLICT for the rare race where two cron ticks fire concurrently.
  const inserted = await db
    .insert(announcements)
    .values({
      source: "irs_newsroom",
      externalId: item.externalId,
      title: item.title,
      summary: item.description.slice(0, 800),
      url: item.link,
      publishedAt: new Date(item.pubDate),
      category: cls.category,
      affectedJurisdictions: cls.affectedJurisdictions,
      relevanceScore: cls.relevanceScore,
      aiSummary: cls.summary,
    })
    .onConflictDoNothing({
      target: [announcements.source, announcements.externalId],
    })
    .returning({ id: announcements.id });

  // If row already existed (race), inserted is empty — fetch its id.
  let rowId = inserted[0]?.id;
  if (!rowId) {
    const lookup = await db.execute<{ id: string }>(sql`
      SELECT id FROM announcements
      WHERE source = 'irs_newsroom' AND external_id = ${item.externalId}
      LIMIT 1
    `);
    rowId = lookup.rows[0]?.id ?? "";
  }

  console.log(
    `[scrape] step=classifyOne ok score=${cls.relevanceScore} cat=${cls.category} jurisdictions=${cls.affectedJurisdictions.join(",")} ms=${Date.now() - t0}`,
  );

  return { id: rowId, classification: cls };
}

// ---------------------------------------------------------------------------
// The workflow — pure orchestration (no Node APIs, no fetch)
// ---------------------------------------------------------------------------

export async function scrapeAnnouncementsWorkflow(): Promise<ScrapeResult> {
  "use workflow";
  console.log("[scrape] workflow start");

  const xml = await fetchIrsNewsroomRss();
  const items = await parseRss(xml);
  const newItems = await filterNewItems(items);

  let classified = 0;
  let classifyErrors = 0;
  const storedIds: string[] = [];

  // Sequential per-item classification. Daily volume is 1–10 new items;
  // parallelism would only matter if we expanded to many feeds at once.
  for (const item of newItems) {
    try {
      const { id } = await classifyAndStoreOne(item);
      classified++;
      if (id) storedIds.push(id);
    } catch (e) {
      classifyErrors++;
      console.error(
        `[scrape] classify failed externalId=${item.externalId.slice(-32)} err=${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  const result: ScrapeResult = {
    fetched: items.length,
    newItems: newItems.length,
    classified,
    classifyErrors,
    storedIds,
  };

  console.log(
    `[scrape] workflow complete fetched=${result.fetched} new=${result.newItems} classified=${result.classified} errors=${result.classifyErrors}`,
  );

  return result;
}
