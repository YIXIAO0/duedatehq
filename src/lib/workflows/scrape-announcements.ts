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
import { and, eq, inArray, sql } from "drizzle-orm";
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
  /** First few classification error messages, for fast triage. */
  errorSamples: string[];
};

// ---------------------------------------------------------------------------
// Step 1 — fetch the IRS Newsroom listing
//
// IRS killed their public RSS feed circa 2022 (every "feed" / "rss"
// candidate URL returns 404 today). Their current "machine-readable
// surface" for press releases is the HTML at
//   https://www.irs.gov/newsroom/news-releases-for-current-month
// which lists every IR-YYYY-NN release for the month with a stable
// slug, abstract text, and IR number we can use as our dedupe key.
//
// We accept the trade-off (HTML scrape vs RSS) because:
//   - IR numbers are CANONICAL — they don't change once issued
//   - the IRS doesn't monetize the page, very low risk of breakage
//   - we only need to keep up with a daily trickle
// ---------------------------------------------------------------------------

const IRS_NEWSROOM_URL =
  "https://www.irs.gov/newsroom/news-releases-for-current-month";

async function fetchIrsNewsroomHtml(): Promise<string> {
  "use step";
  console.log(`[scrape] step=fetchHtml start url=${IRS_NEWSROOM_URL}`);
  const t0 = Date.now();

  let res: Response;
  try {
    res = await fetch(IRS_NEWSROOM_URL, {
      headers: {
        // Polite UA so IRS sees who's hitting them.
        "user-agent": "DueDateHQ/1.0 (+https://duedatehq.com)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
  } catch (e) {
    // Network blip → retry. Workflow runtime backs off automatically.
    throw new RetryableError(
      `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 5xx → retry. 4xx → permanent (most likely a URL change we need to fix).
  if (res.status >= 500) {
    throw new RetryableError(`IRS Newsroom ${res.status}`, {
      retryAfter: "5m",
    });
  }
  if (res.status >= 400) {
    throw new FatalError(
      `IRS Newsroom ${res.status} — page URL likely changed`,
    );
  }
  const html = await res.text();
  console.log(
    `[scrape] step=fetchHtml ok bytes=${html.length} ms=${Date.now() - t0}`,
  );
  return html;
}

// ---------------------------------------------------------------------------
// Step 2 — parse the newsroom HTML into items
//
// We anchor on each `<div class="field_pup_media_document_teaser">` block.
// Inside each block:
//   - <h2><a href="/newsroom/SLUG"><span>TITLE</span></a></h2>   → title + link
//   - <div class="...field-pup-description-abstract...">
//       IR-YYYY-NN, Month D, YYYY — DESCRIPTION
//     </div>                                                     → IR # + date + body
//
// The IR number is our externalId — it's canonical, never changes once
// issued, and the IRS doesn't recycle them. If the IRS restructures the
// page we get zero parsed items and `dedupeAndStore` is a no-op
// (nothing to insert), so a layout change can't corrupt our DB.
// ---------------------------------------------------------------------------

async function parseNewsroomHtml(html: string): Promise<ParsedItem[]> {
  "use step";
  console.log(
    `[scrape] step=parseHtml start bytes=${html.length}`,
  );

  const items: ParsedItem[] = [];
  const blockRegex =
    /<div class="field_pup_media_document_teaser">([\s\S]*?)<\/p>\s*<\/div>/g;

  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[1];

    // Title + link from the <h2><a> with rel="bookmark"
    const linkMatch = block.match(
      /<a\s+href="(\/newsroom\/[^"]+)"[^>]*rel="bookmark"[^>]*>\s*<span>([\s\S]*?)<\/span>/,
    );
    if (!linkMatch) continue;
    const link = `https://www.irs.gov${linkMatch[1]}`;
    const title = decodeEntities(stripHtml(linkMatch[2])).trim();

    // Abstract has the form "IR-2026-57, April 24, 2026 — body…"
    const absMatch = block.match(
      /class="[^"]*field-pup-description-abstract[^"]*field--item">([\s\S]*?)<\/div>/,
    );
    if (!absMatch) continue;
    const absText = decodeEntities(stripHtml(absMatch[1])).trim();

    // Pull IR number + date from the abstract preface.
    const headMatch = absText.match(
      /^(IR-\d{4}-\d{1,4}),\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s*[—-]\s*([\s\S]*)$/,
    );
    if (!headMatch) continue;
    const irNumber = headMatch[1];
    const pubDateRaw = headMatch[2];
    const description = headMatch[3].trim();

    const pubDateDate = new Date(pubDateRaw);
    const pubDate = isNaN(pubDateDate.getTime())
      ? new Date().toISOString()
      : pubDateDate.toISOString();

    items.push({
      externalId: irNumber,
      title,
      link,
      pubDate,
      description: description.slice(0, 1500),
    });
  }

  console.log(
    `[scrape] step=parseHtml extracted=${items.length} sample=${items[0]?.externalId ?? "none"}`,
  );
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

  // Use Drizzle's typed `inArray` rather than a hand-written sql template
  // — `${ids}::text[]` spreads each element as its own param and produces
  // `($1,$2,...)::text[]`, which Postgres reads as a row expression cast
  // and rejects. inArray builds the proper `external_id IN ($1,$2,...)`.
  const existing = await db
    .select({ externalId: announcements.externalId })
    .from(announcements)
    .where(
      and(
        eq(announcements.source, "irs_newsroom"),
        inArray(announcements.externalId, ids),
      ),
    );
  const seen = new Set(existing.map((r) => r.externalId));
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
): Promise<{ id: string; classification: Classification; aiFailed: boolean }> {
  "use step";
  console.log(
    `[scrape] step=classifyOne start externalId=${item.externalId}`,
  );
  const t0 = Date.now();

  // Resilience: if AI is unavailable (e.g. AI Gateway billing wall, model
  // deprecated, schema validation throw), we still want the IRS item in
  // the DB. Better to render a "general/score 3" row than to lose the
  // announcement entirely. A future successful run can re-enrich.
  let cls: Classification;
  let aiFailed = false;
  try {
    const { experimental_output: out } = await generateText({
      model: "anthropic/claude-haiku-4.5",
      temperature: 0.2, // facts, not creativity
      experimental_output: Output.object({ schema: ClassificationSchema }),
      system:
        "You are a CPA's research assistant classifying IRS Newsroom announcements. " +
        "Be conservative on relevance. Score 5 only for items that change a real " +
        "deadline or filing requirement (disaster relief, form threshold change, " +
        "e-file mandate). General PR / outreach / op-ed = 1 or 2. " +
        'If a state list isn\'t explicit, return ["federal"] for nationwide items. ' +
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
    cls = out;
  } catch (e) {
    aiFailed = true;
    const message = e instanceof Error ? e.message : String(e);
    console.warn(
      `[scrape] step=classifyOne ai_unavailable externalId=${item.externalId} fallback_to_default err=${message}`,
    );
    cls = {
      category: "general",
      affectedJurisdictions: [],
      relevanceScore: 3,
      summary: "", // empty so the UI knows AI hasn't enriched this yet
    };
  }

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
    `[scrape] step=classifyOne ok ai=${aiFailed ? "FAILED-stored-as-default" : "ok"} score=${cls.relevanceScore} cat=${cls.category} jurisdictions=${cls.affectedJurisdictions.join(",")} ms=${Date.now() - t0}`,
  );

  return { id: rowId, classification: cls, aiFailed };
}

// ---------------------------------------------------------------------------
// The workflow — pure orchestration (no Node APIs, no fetch)
// ---------------------------------------------------------------------------

export async function scrapeAnnouncementsWorkflow(): Promise<ScrapeResult> {
  "use workflow";
  console.log("[scrape] workflow start");

  const html = await fetchIrsNewsroomHtml();
  const items = await parseNewsroomHtml(html);
  const newItems = await filterNewItems(items);

  let classified = 0;
  let classifyErrors = 0;
  const storedIds: string[] = [];
  const errorSamples: string[] = [];

  // Sequential per-item processing. Daily volume is 1–10 new items;
  // parallelism would only matter if we expanded to many feeds at once.
  // The step itself never throws on AI failure — it stores the row with
  // default classification and returns aiFailed=true. So a try/catch
  // here only fires for unexpected (non-AI) breakage like a DB outage.
  for (const item of newItems) {
    try {
      const { id, aiFailed } = await classifyAndStoreOne(item);
      if (aiFailed) {
        classifyErrors++;
        const msg = "AI Gateway unavailable — stored with default classification (see step logs for vendor message)";
        if (errorSamples.length < 3 && !errorSamples.includes(msg)) {
          errorSamples.push(msg);
        }
      } else {
        classified++;
      }
      if (id) storedIds.push(id);
    } catch (e) {
      classifyErrors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[scrape] classify hard-failed externalId=${item.externalId} err=${msg}`,
      );
      if (errorSamples.length < 3 && !errorSamples.includes(msg)) {
        errorSamples.push(msg);
      }
    }
  }

  const result: ScrapeResult = {
    fetched: items.length,
    newItems: newItems.length,
    classified,
    classifyErrors,
    storedIds,
    errorSamples,
  };

  console.log(
    `[scrape] workflow complete fetched=${result.fetched} new=${result.newItems} classified=${result.classified} errors=${result.classifyErrors}`,
  );

  return result;
}
