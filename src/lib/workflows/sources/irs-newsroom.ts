/**
 * IRS Newsroom source — HTML scrape of the current-month listing page.
 *
 * IRS killed their public RSS feed circa 2022 (every "feed" / "rss"
 * candidate URL returns 404 today). Their current "machine-readable
 * surface" for press releases is the HTML at
 *   https://www.irs.gov/newsroom/news-releases-for-current-month
 * which lists every IR-YYYY-NN release for the month with a stable
 * slug, abstract text, and IR number we use as our dedupe key.
 *
 * IR numbers are CANONICAL — they don't change once issued and the
 * IRS doesn't recycle them. If the IRS restructures the page we get
 * zero parsed items and downstream dedupe is a no-op (nothing to
 * insert), so a layout change can't corrupt our DB.
 */

import { FatalError, RetryableError } from "workflow";
import type { ParsedItem, SourceConfig } from "./types";
import { decodeEntities, stripHtml } from "./util";

const IRS_NEWSROOM_URL =
  "https://www.irs.gov/newsroom/news-releases-for-current-month";

async function fetchHtml(): Promise<string> {
  "use step";
  console.log(`[scrape:irs] step=fetchHtml start url=${IRS_NEWSROOM_URL}`);
  const t0 = Date.now();

  let res: Response;
  try {
    res = await fetch(IRS_NEWSROOM_URL, {
      headers: {
        "user-agent": "DueDateHQ/1.0 (+https://duedatehq.com)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
  } catch (e) {
    throw new RetryableError(
      `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (res.status >= 500) {
    throw new RetryableError(`IRS Newsroom ${res.status}`, { retryAfter: "5m" });
  }
  if (res.status >= 400) {
    throw new FatalError(`IRS Newsroom ${res.status} — page URL likely changed`);
  }
  const html = await res.text();
  console.log(
    `[scrape:irs] step=fetchHtml ok bytes=${html.length} ms=${Date.now() - t0}`,
  );
  return html;
}

async function parse(html: string): Promise<ParsedItem[]> {
  "use step";
  console.log(`[scrape:irs] step=parse start bytes=${html.length}`);

  const items: ParsedItem[] = [];
  const blockRegex =
    /<div class="field_pup_media_document_teaser">([\s\S]*?)<\/p>\s*<\/div>/g;

  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[1];

    const linkMatch = block.match(
      /<a\s+href="(\/newsroom\/[^"]+)"[^>]*rel="bookmark"[^>]*>\s*<span>([\s\S]*?)<\/span>/,
    );
    if (!linkMatch) continue;
    const link = `https://www.irs.gov${linkMatch[1]}`;
    const title = decodeEntities(stripHtml(linkMatch[2])).trim();

    const absMatch = block.match(
      /class="[^"]*field-pup-description-abstract[^"]*field--item">([\s\S]*?)<\/div>/,
    );
    if (!absMatch) continue;
    const absText = decodeEntities(stripHtml(absMatch[1])).trim();

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
    `[scrape:irs] step=parse extracted=${items.length} sample=${items[0]?.externalId ?? "none"}`,
  );
  return items;
}

export const IRS_NEWSROOM: SourceConfig = {
  id: "irs_newsroom",
  displayName: "IRS Newsroom",
  fetch: fetchHtml,
  parse,
};
