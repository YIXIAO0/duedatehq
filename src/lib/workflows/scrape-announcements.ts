/**
 * Daily announcements scrape — the protective moat for DueDateHQ.
 *
 * The whole reason a CPA hires this product instead of writing dates
 * on a whiteboard: we tell them when something changes. Hurricanes,
 * form threshold updates, e-file requirement shifts. CPAs find out
 * about these via tax newsletters or their professional network —
 * slow, sometimes wrong, sometimes too late.
 *
 * This workflow runs every morning before US business hours, pulls a
 * source's listing, classifies each new item with an LLM, and stores
 * the results. Pluggable per-source: pass a `sourceId` and the workflow
 * looks up the matching SourceConfig from the registry. Cron fans out
 * across all registered sources in parallel — each gets its own runId
 * + step cache, so a flaky CA FTB run doesn't block the IRS scrape.
 *
 * Why Workflow DevKit (not a plain cron)?
 *   1. Fetch + N LLM classifications is brittle work. Each step
 *      retries on transient errors. A 503 from a state DOR doesn't
 *      poison the whole run.
 *   2. Step results are persisted, so a partial-failure replay doesn't
 *      burn AI credits re-classifying items we already did.
 *   3. The workflow run page (`vercel workflow web <runId>`) gives a
 *      visual debugger when something looks off in production.
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
import { getDb } from "@/lib/db";
import { announcements, ANNOUNCEMENT_CATEGORIES } from "@/lib/db/schema";
import { getSource } from "./sources";
import type { ParsedItem } from "./sources/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Classification = z.infer<typeof ClassificationSchema>;

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .nullable();

const ClassificationSchema = z.object({
  category: z.enum(ANNOUNCEMENT_CATEGORIES),
  /** ISO state codes ("FL", "TX") or "federal". Empty when unclear. */
  affectedJurisdictions: z.array(z.string().max(8)).max(60),
  /** 1 = trivia, 5 = drop-everything-and-call-clients. */
  relevanceScore: z.number().int().min(1).max(5),
  /** One sentence in CPA-friendly language, ≤ 160 chars. */
  summary: z.string().min(1).max(180),

  /** Form codes the announcement specifically names. ["1040","1120"] for
   *  "individual + corporate returns affected", [] for "all returns" or
   *  items that aren't form-scoped. */
  affectedFormCodes: z.array(z.string().max(20)).max(40),
  /** ISO date — start of the original-deadline window being postponed
   *  by disaster relief. NULL for non-relief items. */
  originalDeadlineStart: IsoDateSchema,
  /** ISO date — end of the original-deadline window. */
  originalDeadlineEnd: IsoDateSchema,
  /** ISO date — the new postponed deadline. NULL for non-relief. */
  reliefDeadline: IsoDateSchema,
  /** Specific counties (or other sub-state areas) named as eligible.
   *  Disaster relief is FEMA-county-specific, not state-wide.
   *  Free-form: ["Hillsborough County, FL", "Manatee County, FL"]. */
  affectedCounties: z.array(z.string().max(120)).max(80),
});

export type ScrapeResult = {
  sourceId: string;
  fetched: number;
  newItems: number;
  classified: number;
  classifyErrors: number;
  storedIds: string[];
  errorSamples: string[];
};

// ---------------------------------------------------------------------------
// Step — filter to items we haven't stored yet (per-source dedupe)
// ---------------------------------------------------------------------------

async function filterNewItems(
  items: ParsedItem[],
  sourceId: string,
): Promise<ParsedItem[]> {
  "use step";
  console.log(
    `[scrape:${sourceId}] step=filterNew checking=${items.length}`,
  );
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
        eq(announcements.source, sourceId),
        inArray(announcements.externalId, ids),
      ),
    );
  const seen = new Set(existing.map((r) => r.externalId));
  const fresh = items.filter((i) => !seen.has(i.externalId));
  console.log(
    `[scrape:${sourceId}] step=filterNew fresh=${fresh.length} dupes=${items.length - fresh.length}`,
  );
  return fresh;
}

// ---------------------------------------------------------------------------
// Step — classify a single item with the LLM and INSERT
//
// Per-item step (rather than batch) so a flaky AI call on item #3 doesn't
// force re-classification of items #1 and #2 on retry. Workflow caches
// step results by their position-in-the-orchestration plus arguments.
// ---------------------------------------------------------------------------

async function classifyAndStoreOne(
  item: ParsedItem,
  sourceId: string,
): Promise<{ id: string; classification: Classification; aiFailed: boolean }> {
  "use step";
  console.log(
    `[scrape:${sourceId}] step=classifyOne start externalId=${item.externalId}`,
  );
  const t0 = Date.now();

  // Resilience: if AI is unavailable (e.g. AI Gateway billing wall, model
  // deprecated, schema validation throw), we still want the item in the
  // DB. Better to render a "general/score 3" row than to lose the
  // announcement entirely. A future successful run can re-enrich.
  let cls: Classification;
  let aiFailed = false;
  try {
    const { experimental_output: out } = await generateText({
      model: "anthropic/claude-haiku-4.5",
      temperature: 0.1,
      experimental_output: Output.object({ schema: ClassificationSchema }),
      system: [
        "You classify tax-authority announcements (IRS, state DORs) for",
        "a tool that manages tax-filing deadlines for US CPAs. The ONLY",
        "question that matters: does this item change what a CPA has to",
        "do or when they have to do it? Most newsroom items are PR (awards,",
        "commemorations, fraud warnings, agency reports, volunteer-week",
        "shoutouts). Those are NOT deadline-relevant.",
        "",
        "Scoring rubric (be strict — default is 1, not 3):",
        "  5 = deadline explicitly extended/moved, OR filing requirement",
        "      just changed (e.g. 'IRS postpones Apr 15 deadline for FL",
        "      hurricane victims', '1099-K threshold lowered to $5,000',",
        "      'e-file now required for X form').",
        "  4 = new guidance / safe harbor / procedure that most CPAs in",
        "      affected jurisdictions need to read this week.",
        "  3 = routine reminder of an upcoming deadline, or generally-",
        "      useful procedural update (e.g. 'direct deposit reminder',",
        "      'how to get a transcript').",
        "  2 = PR adjacent to filing but no action needed ('agency has",
        "      processed X million returns', 'watch out for tax scams').",
        "  1 = pure PR / internal news / awards / commemorations / op-ed /",
        "      leadership appointments / volunteer-week shoutouts / TAS",
        "      annual report / statistics-of-income releases.",
        "",
        "Category rules:",
        "  disaster_relief — ONLY when the agency explicitly postpones",
        "                    filing or payment deadlines due to a declared",
        "                    disaster.",
        "  form_change     — threshold / form / schedule change that",
        "                    changes what gets filed.",
        "  procedural      — e-file mandate, payment method change,",
        "                    registration requirement, safe harbor.",
        "  general         — everything else (default for score ≤ 2).",
        "",
        "Jurisdictions: return the 2-letter state codes explicitly named",
        "in the title/excerpt, OR ['federal'] for nationwide items. If",
        "unclear, return ['federal']. If a county-level scope (e.g.",
        "'Harris County, TX'), still just return the state code. NB: when",
        "the source itself is a state DOR (e.g. Texas Comptroller), the",
        "default jurisdiction is that state — DO NOT default to ['federal']",
        "for state-DOR-issued releases.",
        "",
        "Summary: ONE short sentence, plain CPA English, max 160 chars.",
        "Say WHAT changed and WHO is affected. Don't copy the title.",
        "",
        "STRUCTURED EXTRACTION (these narrow the affected-clients match",
        "from 'all clients in this state' to 'clients with the actual",
        "affected work'). Be conservative — empty array / null is the",
        "right answer when the item doesn't say.",
        "",
        "affectedFormCodes: form codes the announcement specifically names.",
        "  - '1040' for individual returns, '1120' for C-corp, '1120S'",
        "    for S-corp, '1065' for partnership, '941' for payroll, '1099'",
        "    for info returns, '5500' for retirement plans, etc. State",
        "    forms get the state's canonical code (e.g. 'CA-540', 'NY-IT-201').",
        "  - [] when generic ('all returns') or no form named.",
        "",
        "originalDeadlineStart / originalDeadlineEnd: ISO YYYY-MM-DD.",
        "  - The ORIGINAL statutory deadline(s) being postponed. Extract",
        "    the SPECIFIC date(s) including the year.",
        "  - When a single deadline is postponed, set start = end.",
        "  - null when not a deadline-postponement item.",
        "",
        "reliefDeadline: ISO YYYY-MM-DD. The new postponed deadline.",
        "  - null when not applicable or unclear.",
        "",
        "affectedCounties: ['Hillsborough County, FL', …]. State-DOR",
        "releases sometimes scope to county groups; capture them verbatim.",
        "  - [] for non-disaster items or when no county scope is given.",
        "  - Don't invent counties.",
        "",
        "If unsure on a date or county, return null / [] — a wrong value",
        "is worse than no value because it would silently misclassify",
        "clients.",
        "",
        `Source: ${sourceId} (use this to set the right default jurisdiction).`,
      ].join("\n"),
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
      `[scrape:${sourceId}] step=classifyOne ai_unavailable externalId=${item.externalId} fallback_to_default err=${message}`,
    );
    cls = {
      category: "general",
      affectedJurisdictions: [],
      relevanceScore: 3,
      summary: "",
      affectedFormCodes: [],
      originalDeadlineStart: null,
      originalDeadlineEnd: null,
      reliefDeadline: null,
      affectedCounties: [],
    };
  }

  const db = getDb();
  const inserted = await db
    .insert(announcements)
    .values({
      source: sourceId,
      externalId: item.externalId,
      title: item.title,
      summary: item.description.slice(0, 800),
      url: item.link,
      publishedAt: new Date(item.pubDate),
      category: cls.category,
      affectedJurisdictions: cls.affectedJurisdictions,
      relevanceScore: cls.relevanceScore,
      aiSummary: cls.summary,
      affectedFormCodes: cls.affectedFormCodes,
      originalDeadlineStart: cls.originalDeadlineStart,
      originalDeadlineEnd: cls.originalDeadlineEnd,
      reliefDeadline: cls.reliefDeadline,
      affectedCounties: cls.affectedCounties,
    })
    .onConflictDoNothing({
      target: [announcements.source, announcements.externalId],
    })
    .returning({ id: announcements.id });

  let rowId = inserted[0]?.id;
  if (!rowId) {
    const lookup = await db.execute<{ id: string }>(sql`
      SELECT id FROM announcements
      WHERE source = ${sourceId} AND external_id = ${item.externalId}
      LIMIT 1
    `);
    rowId = lookup.rows[0]?.id ?? "";
  }

  console.log(
    `[scrape:${sourceId}] step=classifyOne ok ai=${aiFailed ? "FAILED-stored-as-default" : "ok"} score=${cls.relevanceScore} cat=${cls.category} jurisdictions=${cls.affectedJurisdictions.join(",")} ms=${Date.now() - t0}`,
  );

  return { id: rowId, classification: cls, aiFailed };
}

// ---------------------------------------------------------------------------
// The workflow — pure orchestration (no Node APIs, no fetch)
//
// Takes a sourceId; the source's fetch + parse run as their own steps,
// then the shared filter + classify+store loop runs over the new items.
// One workflow run = one source. Cron fans out across all registered
// sources in parallel.
// ---------------------------------------------------------------------------

export async function scrapeAnnouncementsWorkflow(
  sourceId: string,
): Promise<ScrapeResult> {
  "use workflow";
  console.log(`[scrape:${sourceId}] workflow start`);

  const source = getSource(sourceId);

  const raw = await source.fetch();
  const items = await source.parse(raw);
  const newItems = await filterNewItems(items, sourceId);

  let classified = 0;
  let classifyErrors = 0;
  const storedIds: string[] = [];
  const errorSamples: string[] = [];

  for (const item of newItems) {
    try {
      const { id, aiFailed } = await classifyAndStoreOne(item, sourceId);
      if (aiFailed) {
        classifyErrors++;
        const msg =
          "AI Gateway unavailable — stored with default classification (see step logs for vendor message)";
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
        `[scrape:${sourceId}] classify hard-failed externalId=${item.externalId} err=${msg}`,
      );
      if (errorSamples.length < 3 && !errorSamples.includes(msg)) {
        errorSamples.push(msg);
      }
    }
  }

  const result: ScrapeResult = {
    sourceId,
    fetched: items.length,
    newItems: newItems.length,
    classified,
    classifyErrors,
    storedIds,
    errorSamples,
  };

  console.log(
    `[scrape:${sourceId}] workflow complete fetched=${result.fetched} new=${result.newItems} classified=${result.classified} errors=${result.classifyErrors}`,
  );

  return result;
}
