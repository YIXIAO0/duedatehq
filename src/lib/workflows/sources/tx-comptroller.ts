/**
 * Texas Comptroller of Public Accounts — news releases via GovDelivery RSS.
 *
 * The Comptroller's office is the only state DOR (of our top-5 set)
 * that publishes a real RSS feed. Hosted at GovDelivery
 * (`public.govdelivery.com/topics/TXCOMPT_1/feed.rss`, RSS 2.0). Each
 * <item> contains <title>, <link>, <pubDate>, <guid>, <description>.
 *
 * GovDelivery's feed lists releases by date desc; we take whatever the
 * feed currently exposes and let the dedupe step skip ones we've seen.
 * No pagination needed — the feed surfaces ~20-50 recent items, plenty
 * for a daily scrape.
 *
 * Why guid is the externalId: GovDelivery guids are URL-shaped and
 * stable per release. The Texas Comptroller doesn't issue press-release
 * numbers like the IRS does, so URL-based dedupe is the natural key.
 */

import { FatalError, RetryableError } from "workflow";
import type { ParsedItem, SourceConfig } from "./types";
import { decodeEntities, stripHtml, toIsoOrNow } from "./util";

const TX_COMPTROLLER_RSS_URL =
  "https://public.govdelivery.com/topics/TXCOMPT_1/feed.rss";

async function fetchRss(): Promise<string> {
  "use step";
  console.log(
    `[scrape:tx_comptroller] step=fetchRss start url=${TX_COMPTROLLER_RSS_URL}`,
  );
  const t0 = Date.now();

  let res: Response;
  try {
    res = await fetch(TX_COMPTROLLER_RSS_URL, {
      headers: {
        "user-agent": "DueDateHQ/1.0 (+https://duedatehq.com)",
        accept: "application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } catch (e) {
    throw new RetryableError(
      `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (res.status >= 500) {
    throw new RetryableError(`TX Comptroller RSS ${res.status}`, {
      retryAfter: "5m",
    });
  }
  if (res.status >= 400) {
    throw new FatalError(
      `TX Comptroller RSS ${res.status} — feed URL likely changed`,
    );
  }
  const xml = await res.text();
  console.log(
    `[scrape:tx_comptroller] step=fetchRss ok bytes=${xml.length} ms=${Date.now() - t0}`,
  );
  return xml;
}

async function parse(xml: string): Promise<ParsedItem[]> {
  "use step";
  console.log(
    `[scrape:tx_comptroller] step=parse start bytes=${xml.length}`,
  );

  const items: ParsedItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;

  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];

    const title = decodeEntities(
      stripHtml(extractTag(block, "title") ?? ""),
    ).trim();
    const link = (extractTag(block, "link") ?? "").trim();
    const pubDateRaw = (extractTag(block, "pubDate") ?? "").trim();
    const guid = (extractTag(block, "guid") ?? "").trim();
    const descriptionRaw = extractTag(block, "description") ?? "";
    const description = decodeEntities(stripHtml(descriptionRaw)).trim();

    // Skip items that lack a stable id (guid OR link) — without it
    // dedupe can't anchor and we'd re-insert on every run.
    const externalId = guid || link;
    if (!externalId || !title) continue;

    items.push({
      externalId,
      title,
      link: link || externalId,
      pubDate: toIsoOrNow(pubDateRaw),
      description: description.slice(0, 1500),
    });
  }

  console.log(
    `[scrape:tx_comptroller] step=parse extracted=${items.length} sample=${items[0]?.externalId ?? "none"}`,
  );
  return items;
}

/**
 * Pull the inner text of a single XML tag. CDATA-aware (the GovDelivery
 * feed wraps title/description in <![CDATA[...]]>).
 */
function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  if (!m) return null;
  const inner = m[1];
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : inner;
}

export const TX_COMPTROLLER: SourceConfig = {
  id: "tx_comptroller",
  displayName: "Texas Comptroller",
  fetch: fetchRss,
  parse,
};
