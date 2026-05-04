/**
 * Tiny shared parser helpers used across source modules. Kept dependency-
 * free (no DOM, no external libs) so the workflow steps stay portable
 * across the workflow runtime's sandbox.
 */

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Best-effort ISO conversion. Returns now() ISO if input doesn't parse. */
export function toIsoOrNow(raw: string): string {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
